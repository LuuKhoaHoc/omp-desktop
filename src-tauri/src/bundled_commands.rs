//! omp file commands that ship with the app. omp lists a `*.md` file in
//! `<agent dir>/commands/` as a command, so the palette shows it and omp
//! expands it; the app only has to put the file there. A file already in
//! place is never touched, so a user who edited the command keeps their
//! version. Nothing here deletes anything: a user who does not want
//! `/swarm` removes the file, and the next start puts it back.

use std::ffi::OsStr;
use std::fs::{self, OpenOptions};
use std::io::{self, Write};
use std::path::Path;

/// (file name, content), from `src-tauri/bundled/commands/`.
const COMMANDS: [(&str, &str); 1] = [("swarm.md", include_str!("../bundled/commands/swarm.md"))];

/// Write each bundled command that is missing into `<agent dir>/commands/`.
fn install(agent_dir: &Path) -> io::Result<()> {
    let dir = agent_dir.join("commands");
    fs::create_dir_all(&dir)?;
    for (name, content) in COMMANDS {
        match OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(dir.join(name))
        {
            Ok(mut file) => file.write_all(content.as_bytes())?,
            Err(e) if e.kind() == io::ErrorKind::AlreadyExists => {}
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
