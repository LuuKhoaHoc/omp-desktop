use super::CommitResult;
use std::path::Path;

/// Commit exactly the existing index. No pathspec or staging command is used.
pub fn commit_staged(repo_root: &Path, message: &str) -> Result<CommitResult, String> {
    if message.trim().is_empty() {
        return Err("commit message must not be empty".to_owned());
    }

    let (_gate, repo, work_dir) = crate::workspace::discover(repo_root)?;
    let staged = crate::git_browser::status(repo_root)?.staged;
    if staged.is_empty() {
        return Err("nothing is staged to commit".to_owned());
    }

    let head_name = repo
        .head_name()
        .map_err(|error| format!("could not read HEAD: {error}"))?;
    if head_name.is_none() {
        return Err("cannot commit while HEAD is detached".to_owned());
    }

    // Do not supply paths: `git commit` must use the current index. Hooks and
    // signing remain enabled so the user's Git configuration is respected.
    crate::workspace::git_run(&work_dir, &["commit", "-m", message], "commit")?;
    let sha = String::from_utf8_lossy(&crate::workspace::git_run(
        &work_dir,
        &["rev-parse", "HEAD"],
        "rev-parse",
    )?)
    .trim()
    .to_owned();
    Ok(CommitResult {
        sha,
        message: message.to_owned(),
    })
}

#[cfg(test)]
mod tests {
    use super::commit_staged;
    use crate::git_browser::fixture;

    fn seeded_repo(tag: &str) -> Option<fixture::Repo> {
        let repo = fixture::init(tag)?;
        repo.write("tracked.txt", "base\n");
        repo.git(&["add", "tracked.txt"]);
        repo.commit("initial", 1);
        Some(repo)
    }

    #[test]
    fn commit_uses_index_and_leaves_same_file_worktree_edit_unstaged() {
        let Some(repo) = seeded_repo("ship-index-only") else {
            return;
        };
        repo.write("tracked.txt", "staged content\n");
        repo.git(&["add", "tracked.txt"]);
        repo.write("tracked.txt", "later unstaged content\n");

        let committed = commit_staged(repo.path(), "ship staged content").expect("commit index");

        assert_eq!(
            repo.git(&["show", "HEAD:tracked.txt"]).trim(),
            "staged content"
        );
        assert_eq!(
            std::fs::read_to_string(repo.path().join("tracked.txt")).expect("read worktree"),
            "later unstaged content\n"
        );
        assert_eq!(repo.git(&["diff", "--cached", "--name-only"]), "");
        assert_eq!(repo.git(&["diff", "--name-only"]).trim(), "tracked.txt");
        assert_eq!(committed.sha, repo.git(&["rev-parse", "HEAD"]).trim());
        assert_eq!(committed.message, "ship staged content");
    }

    #[test]
    fn commit_rejects_empty_index_and_blank_message() {
        let Some(repo) = seeded_repo("ship-empty") else {
            return;
        };
        let empty = commit_staged(repo.path(), "commit anyway").expect_err("empty index");
        assert!(empty.contains("nothing is staged"), "{empty}");

        repo.write("tracked.txt", "staged\n");
        repo.git(&["add", "tracked.txt"]);
        let blank = commit_staged(repo.path(), " \n\t").expect_err("blank message");
        assert!(blank.contains("message must not be empty"), "{blank}");
        assert_eq!(
            repo.git(&["diff", "--cached", "--name-only"]).trim(),
            "tracked.txt"
        );
    }

    #[test]
    fn commit_rejects_detached_head() {
        let Some(repo) = seeded_repo("ship-detached") else {
            return;
        };
        repo.git(&["checkout", "--detach", "HEAD"]);
        repo.write("tracked.txt", "staged\n");
        repo.git(&["add", "tracked.txt"]);

        let error = commit_staged(repo.path(), "commit staged").expect_err("detached HEAD");
        assert!(error.contains("HEAD is detached"), "{error}");
        assert_eq!(
            repo.git(&["diff", "--cached", "--name-only"]).trim(),
            "tracked.txt"
        );
    }

    #[cfg(unix)]
    #[test]
    fn failing_hook_is_bounded_and_preserves_index_and_worktree() {
        let Some(repo) = seeded_repo("ship-failing-hook") else {
            return;
        };
        repo.write("tracked.txt", "staged\n");
        repo.git(&["add", "tracked.txt"]);
        let hooks = repo.path().join("hooks");
        std::fs::create_dir_all(&hooks).expect("create hooks directory");
        let hook = hooks.join("pre-commit");
        let noisy_hook = "#!/bin/sh\nprintf '%040000d' 0 >&2\nexit 1\n";
        std::fs::write(&hook, noisy_hook).expect("write hook");
        let mut permissions = std::fs::metadata(&hook)
            .expect("hook metadata")
            .permissions();
        use std::os::unix::fs::PermissionsExt;
        permissions.set_mode(0o755);
        std::fs::set_permissions(&hook, permissions).expect("make hook executable");
        repo.git(&[
            "config",
            "core.hooksPath",
            hooks.to_str().expect("utf-8 hooks path"),
        ]);

        let error = commit_staged(repo.path(), "fails in hook").expect_err("hook rejects commit");
        assert!(error.contains("git commit failed"), "{error}");
        assert!(error.len() < 20_000, "error exceeded cap: {}", error.len());
        assert_eq!(
            repo.git(&["diff", "--cached", "--name-only"]).trim(),
            "tracked.txt"
        );
        assert_eq!(
            std::fs::read_to_string(repo.path().join("tracked.txt")).expect("read worktree"),
            "staged\n"
        );
        assert_eq!(
            repo.git(&["rev-parse", "--abbrev-ref", "HEAD"]).trim(),
            "main"
        );
    }

    #[test]
    fn commands_use_repo_discovery_from_a_nested_folder() {
        let Some(repo) = seeded_repo("ship-nested") else {
            return;
        };
        repo.write("nested/marker.txt", "staged\n");
        repo.git(&["add", "nested/marker.txt"]);

        let nested = repo.path().join("nested");
        assert_eq!(
            crate::git_browser::status(&nested)
                .expect("discover enclosing repository")
                .staged,
            ["nested/marker.txt"]
        );
    }
}
