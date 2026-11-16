use std::io::{Read, Write};
use std::net::TcpListener;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use serde_json::json;

use crate::test_support::eventually;

use super::super::lock;
use super::super::tests::{mouse, panel, CHROMIUM};
use super::super::view::{BrowserEmit, Frame, InputEvent, Pick, TabInfo, View, ViewState};
use super::{copied_text, MAX_TEXT};

#[test]
fn only_bounded_text_is_a_copy() {
    assert_eq!(copied_text(&json!({ "payload": "hi" })), Some("hi"));
    assert_eq!(copied_text(&json!({ "payload": "" })), None);
    assert_eq!(copied_text(&json!({ "payload": 3 })), None);
    assert_eq!(copied_text(&json!({})), None);
    let long = "x".repeat(MAX_TEXT + 1);
    assert_eq!(copied_text(&json!({ "payload": long })), None);
}

#[derive(Default)]
struct Copies(Mutex<Vec<String>>);

impl Copies {
    fn last(&self) -> Option<String> {
        lock(&self.0).last().cloned() // owned: compared after the lock
    }
}

impl BrowserEmit for Copies {
    fn frame(&self, _: &str, _: &Frame) {}
    fn tabs(&self, _: &str, _: &[TabInfo]) {}
    fn state(&self, _: &str, _: &ViewState) {}
    fn pick(&self, _: &str, _: &Pick) {}
    fn copied(&self, _: &str, text: &str) {
        lock(&self.0).push(text.to_owned());
    }
}

/// `navigator.clipboard` needs a secure context: loopback http, not `data:`.
const PAGE: &str = r#"<p id=t>hello world</p><input id=i value="in a field">
<button id=b style="position:absolute;left:100px;top:100px;width:100px;height:50px">copy</button>
<script>
b.onclick = () => navigator.clipboard.writeText("from the button").then(() => document.title = "written", e => document.title = "refused: " + e);
window.selectText = () => { const r = document.createRange(); r.selectNodeContents(t); const s = getSelection(); s.removeAllRanges(); s.addRange(r); };
</script>"#;

fn serve() -> String {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let origin = format!("http://127.0.0.1:{}", listener.local_addr().unwrap().port());
    std::thread::spawn(move || {
        for stream in listener.incoming() {
            let Ok(mut stream) = stream else { continue };
            let mut request = [0u8; 2048];
            let _ = stream.read(&mut request);
            let head = format!(
                "HTTP/1.1 200 OK\r\nContent-Type: text/html\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
                PAGE.len()
            );
            let _ = stream.write_all(head.as_bytes());
            let _ = stream.write_all(PAGE.as_bytes());
        }
    });
    origin
}

fn ctrl(view: &View, key: &str, code: &str, vk: u32) {
    for kind in ["rawKeyDown", "keyUp"] {
        view.input(&InputEvent::Key {
            r#type: kind.into(),
            key: key.into(),
            code: code.into(),
            text: None,
            modifiers: 2,
            windows_virtual_key_code: vk,
        })
        .unwrap();
    }
}

fn copies(seen: &Copies, text: &str) {
    assert!(
        eventually(Duration::from_secs(5), || {
            (seen.last().as_deref() == Some(text)).then_some(())
        })
        .is_some(),
        "copied {text:?}, saw {:?}",
        lock(&seen.0)
    );
}

#[test]
fn what_the_user_copies_in_the_page_is_reported() {
    let _chromium = lock(&CHROMIUM);
    let seen = Arc::new(Copies::default());
    let emit = Arc::clone(&seen) as Arc<dyn BrowserEmit>;
    let Some((m, view)) = panel("clipboard-copy", 1.0, emit) else {
        return;
    };
    view.navigate(&format!("{}/", serve())).unwrap();
    let ready = || {
        (view.evaluate_for_test("typeof selectText").ok() == Some(json!("function"))).then_some(())
    };
    assert!(
        eventually(Duration::from_secs(10), ready).is_some(),
        "page loaded"
    );

    // A copy nobody at the panel asked for stays in the page.
    view.evaluate_for_test("(selectText(), document.execCommand('copy'))")
        .unwrap();
    std::thread::sleep(Duration::from_millis(300));
    assert_eq!(seen.last(), None, "a script's copy, no panel gesture");

    // Ctrl+C: the selection.
    ctrl(&view, "c", "KeyC", 67);
    copies(&seen, "hello world");

    // A field's selection, cut.
    view.evaluate_for_test("(i.focus(), i.setSelectionRange(0, 2), 1)")
        .unwrap();
    ctrl(&view, "x", "KeyX", 88);
    copies(&seen, "in");
    assert_eq!(
        view.evaluate_for_test("i.value").unwrap(),
        json!(" a field"),
        "the cut still happened in the page"
    );

    // The context menu: what is at a point, and its Copy.
    let at = view.context_at(150.0, 125.0).unwrap();
    assert_eq!((at.link, at.editable), (None, false), "the button");
    view.evaluate_for_test("(selectText(), 1)").unwrap();
    assert!(view.context_at(5.0, 5.0).unwrap().selection);
    view.input(&InputEvent::Edit {
        command: "copy".into(),
    })
    .unwrap();
    copies(&seen, "hello world");

    // A handler that sets the data itself.
    view.evaluate_for_test(
        "(document.addEventListener('copy', e => { e.clipboardData.setData('text/plain', 'set by the page'); e.preventDefault(); e.stopPropagation(); }), selectText(), 1)",
    )
    .unwrap();
    ctrl(&view, "c", "KeyC", 67);
    copies(&seen, "set by the page");

    // A Copy button: `navigator.clipboard.writeText`, which headless
    // Chromium refuses without the granted permission.
    for step in ["mouseMoved", "mousePressed", "mouseReleased"] {
        view.input(&mouse(step, 150.0, 125.0)).unwrap();
    }
    copies(&seen, "from the button");
    assert_eq!(
        view.evaluate_for_test("document.title").unwrap(),
        json!("written")
    );
    m.release("s1");
}
