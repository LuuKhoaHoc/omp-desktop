//! omp file commands that ship with the app. omp lists a `*.md` file in
//! `<agent dir>/commands/` as a command, so the palette shows it and omp
//! expands it; the app only has to put the file there. A file that holds
//! the text an earlier build installed is replaced with this build's; any
//! other file already in place is never touched, so a user who edited the
//! command keeps their version. Nothing here deletes anything: a user who
//! does not want `/swarm` removes the file, and the next start puts it back.

use std::ffi::OsStr;
use std::fs::{self, OpenOptions};
use std::io::{self, Write};
use std::path::Path;

/// A command from `src-tauri/bundled/commands/`. `superseded` holds every
/// text an earlier build installed under `name` (`superseded/<name>-<n>.md`):
/// a change to `content` moves the old text there, or copies already
/// installed keep it forever.
struct Command {
    name: &'static str,
    content: &'static str,
    superseded: &'static [&'static str],
}

const COMMANDS: [Command; 1] = [Command {
    name: "swarm.md",
    content: include_str!("../bundled/commands/swarm.md"),
    superseded: &[include_str!("../bundled/commands/superseded/swarm-1.md")],
}];

/// Whether `path` holds, byte for byte, a text an earlier build installed.
/// An unreadable file counts as the user's.
fn is_superseded(path: &Path, command: &Command) -> bool {
    fs::read(path).is_ok_and(|installed| {
        command
            .superseded
            .iter()
            .any(|old| old.as_bytes() == installed)
    })
}

/// Write each bundled command into `<agent dir>/commands/` where it is
/// missing or still an earlier build's text.
fn install(agent_dir: &Path) -> io::Result<()> {
    let dir = agent_dir.join("commands");
    fs::create_dir_all(&dir)?;
    for command in &COMMANDS {
        let path = dir.join(command.name);
        match OpenOptions::new().write(true).create_new(true).open(&path) {
            Ok(mut file) => file.write_all(command.content.as_bytes())?,
            Err(e) if e.kind() == io::ErrorKind::AlreadyExists => {
                if is_superseded(&path, command) {
                    crate::json_store::write_atomic(&path, command.content.as_bytes())?;
                }
            }
            Err(e) => return Err(e),
        }
    }
    Ok(())
}

/// Install the bundled commands for `profile`'s agent directory before its
/// omp starts. Best effort: a failure is logged and never stops the tab.
pub fn install_for(home: &Path, profile: Option<&str>, env_dir: Option<&OsStr>) {
    let agent_dir = crate::profiles::agent_dir_for(home, profile, env_dir);
    if let Err(e) = install(&agent_dir) {
        eprintln!(
            "[omp-desktop] could not install bundled commands in {}: {e}",
            agent_dir.display()
        );
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_support::TempDir;

    #[test]
    fn installs_the_swarm_command_with_its_frontmatter() {
        let agent = TempDir::new("bundled-commands", "fresh");
        install(agent.path()).unwrap();
        let text = fs::read_to_string(agent.path().join("commands/swarm.md")).unwrap();
        assert!(
            text.starts_with("---\n"),
            "omp reads the description from frontmatter"
        );
        assert!(text.contains("$ARGUMENTS"), "the task is passed through");
    }

    #[test]
    fn keeps_a_command_the_user_edited() {
        let agent = TempDir::new("bundled-commands", "edited");
        let file = agent.path().join("commands/swarm.md");
        fs::create_dir_all(file.parent().unwrap()).unwrap();
        fs::write(&file, "my own swarm").unwrap();
        install(agent.path()).unwrap();
        assert_eq!(fs::read_to_string(&file).unwrap(), "my own swarm");
    }

    #[test]
    fn replaces_a_copy_an_earlier_build_installed() {
        let agent = TempDir::new("bundled-commands", "superseded");
        let file = agent.path().join("commands/swarm.md");
        fs::create_dir_all(file.parent().unwrap()).unwrap();
        let swarm = &COMMANDS[0];
        for old in swarm.superseded {
            assert_ne!(
                *old, swarm.content,
                "a superseded text is not the current one"
            );
            fs::write(&file, old).unwrap();
            install(agent.path()).unwrap();
            assert_eq!(fs::read_to_string(&file).unwrap(), swarm.content);
        }
    }

    #[test]
    fn a_profile_gets_its_own_copy_and_a_second_run_changes_nothing() {
        let home = TempDir::new("bundled-commands", "home");
        install_for(home.path(), Some("work"), None);
        let file = home
            .path()
            .join(".omp/profiles/work/agent/commands/swarm.md");
        assert!(file.is_file(), "{}", file.display());
        let before = fs::metadata(&file).unwrap().modified().unwrap();
        install_for(home.path(), Some("work"), None);
        assert_eq!(fs::metadata(&file).unwrap().modified().unwrap(), before);
    }
}
