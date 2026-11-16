// Runs in the page's own world. `navigator.clipboard.writeText` / `write`
// fire no copy event, so a write that succeeded is announced to
// `bridge.js` (the isolated world) with a DOM event; so is the text a copy
// or cut handler sets, which a handler that stops the event hides from it. Nothing privileged is
// exposed here: the event only says what the page just wrote itself.
(() => {
  const proto = window.Clipboard && window.Clipboard.prototype;
  const mark = Symbol.for("omp.clipboard");
  if (!proto || proto[mark]) return;
  Object.defineProperty(proto, mark, { value: true });
  const tell = (text) => {
    try {
      window.dispatchEvent(new CustomEvent("__omp-clipboard-write", { detail: String(text) }));
    } catch {}
  };
  const transfer = window.DataTransfer && window.DataTransfer.prototype;
  if (transfer) {
    const { setData } = transfer;
    transfer.setData = function (format, data) {
      const type = window.event && window.event.type;
      const plain = /^text(\/plain)?$/i.test(String(format));
      if (plain && (type === "copy" || type === "cut")) tell(data);
      return setData.apply(this, arguments);
    };
  }
  const { writeText, write } = proto;
  proto.writeText = function (text) {
    const done = writeText.apply(this, arguments);
    done.then(() => tell(text), () => {});
    return done;
  };
  proto.write = function (items) {
    const done = write.apply(this, arguments);
    done.then(async () => {
      for (const item of items || []) {
        if (!item.types || !item.types.includes("text/plain")) continue;
        tell(await (await item.getType("text/plain")).text());
        return;
      }
    }).catch(() => {});
    return done;
  };
})();
