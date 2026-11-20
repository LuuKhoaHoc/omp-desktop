use super::{provider_of, PushInfo, Remote};
use std::path::Path;

pub fn remotes(repo_root: &Path) -> Result<Vec<Remote>, String> {
    let (_gate, repo, _) = crate::workspace::discover(repo_root)?;
    let mut remotes = Vec::new();
    for name in repo.remote_names() {
        let name = std::str::from_utf8(name.as_ref())
            .map_err(|_| "remote name is not UTF-8".to_string())?
            .to_owned();
        let remote = repo
            .find_remote(name.as_str())
            .map_err(|e| format!("could not read remote {name:?}: {e}"))?;
        let url = remote
            .url(gix::remote::Direction::Fetch)
            .or_else(|| remote.url(gix::remote::Direction::Push))
            .ok_or_else(|| format!("remote {name:?} has no URL"))?;
        let mut safe_url = url.clone();
        safe_url.set_password(None);
        let _ = safe_url.set_user(None);
        remotes.push(Remote {
            name,
            url: safe_url.to_bstring().to_string(),
            provider: provider_of(url).to_owned(),
        });
    }
    Ok(remotes)
}

pub fn push(repo_root: &Path, remote_name: &str) -> Result<PushInfo, String> {
    let (_gate, repo, work_dir) = crate::workspace::discover(repo_root)?;
    let head = repo
        .head_name()
        .map_err(|e| format!("could not read HEAD: {e}"))?
        .ok_or_else(|| "cannot push while HEAD is detached".to_string())?;
    let branch = std::str::from_utf8(head.shorten().as_ref())
        .map_err(|_| "branch name is not UTF-8".to_string())?
        .to_owned();
    if repo.try_find_remote(remote_name).is_none() {
        return Err(format!("push: no remote named {remote_name:?}"));
    }
    let has_upstream = repo
        .branch_remote_ref_name(head.as_ref(), gix::remote::Direction::Fetch)
        .map(|result| result.map(|_| ()))
        .transpose()
        .map_err(|e| format!("could not read branch upstream: {e}"))?
        .is_some();
    let args = if !has_upstream {
        vec!["push", "--set-upstream", remote_name, &branch]
    } else {
        vec!["push", remote_name, &branch]
    };
    crate::workspace::git_run(&work_dir, &args, "push")?;
    Ok(PushInfo {
        upstream: format!("{remote_name}/{branch}"),
        branch,
        remote: remote_name.to_owned(),
    })
}

#[cfg(test)]
mod tests {
    use super::{push, remotes};
    use crate::git_browser::fixture;
    use std::process::Command;

    fn seeded_repo(tag: &str) -> Option<fixture::Repo> {
        let repo = fixture::init(tag)?;
        repo.write("tracked.txt", "base\n");
        repo.git(&["add", "tracked.txt"]);
        repo.commit("initial", 1);
        Some(repo)
    }

    #[test]
    fn lists_configured_remote_providers_and_discovers_nested_folder() {
        let Some(repo) = seeded_repo("ship-remotes") else {
            return;
        };
        repo.git(&["remote", "add", "github", "https://github.com/o/r.git"]);
        repo.git(&[
            "remote",
            "add",
            "gitlab",
            "https://gitlab.example.com/o/r.git",
        ]);
        repo.git(&["remote", "add", "other", "https://bitbucket.org/o/r.git"]);
        let nested = repo.path().join("nested");
        std::fs::create_dir_all(&nested).expect("nested directory");
        let listed = remotes(&nested).expect("list remotes");
        assert_eq!(listed.len(), 3);
        assert_eq!(
            listed.iter().find(|r| r.name == "github").unwrap().provider,
            "github"
        );
        assert_eq!(
            listed.iter().find(|r| r.name == "gitlab").unwrap().provider,
            "gitlab"
        );
        assert_eq!(
            listed.iter().find(|r| r.name == "other").unwrap().provider,
            "other"
        );
    }

    #[test]
    fn pushes_to_explicit_remote_and_refuses_unknown_or_detached() {
        let Some(repo) = seeded_repo("ship-push") else {
            return;
        };
        let bare = repo.path().join("remote.git");
        assert!(Command::new("git")
            .args(["init", "--bare"])
            .arg(&bare)
            .status()
            .unwrap()
            .success());
        repo.git(&["remote", "add", "origin", bare.to_str().unwrap()]);
        let pushed = push(repo.path(), "origin").expect("push");
        assert_eq!(pushed.branch, "main");
        assert_eq!(pushed.upstream, "origin/main");
        let remote_head = Command::new("git")
            .arg("--git-dir")
            .arg(&bare)
            .args(["rev-parse", "refs/heads/main"])
            .output()
            .unwrap();
        assert_eq!(
            String::from_utf8_lossy(&remote_head.stdout).trim(),
            repo.git(&["rev-parse", "HEAD"]).trim()
        );
        assert!(push(repo.path(), "missing")
            .unwrap_err()
            .contains("missing"));
        repo.git(&["checkout", "--detach", "HEAD"]);
        assert_eq!(
            push(repo.path(), "origin").unwrap_err(),
            "cannot push while HEAD is detached"
        );
    }

    #[test]
    fn non_fast_forward_push_does_not_change_local_head_or_index() {
        let Some(repo) = seeded_repo("ship-non-fast-forward") else {
            return;
        };
        let bare = repo.path().join("remote.git");
        assert!(Command::new("git")
            .args(["init", "--bare"])
            .arg(&bare)
            .status()
            .unwrap()
            .success());
        repo.git(&["remote", "add", "origin", bare.to_str().unwrap()]);
        push(repo.path(), "origin").expect("initial push");
        assert!(Command::new("git")
            .arg("--git-dir")
            .arg(&bare)
            .args(["symbolic-ref", "HEAD", "refs/heads/main"])
            .status()
            .unwrap()
            .success());
        repo.write("tracked.txt", "local\n");
        repo.git(&["add", "tracked.txt"]);
        let alternate = repo.path().join("alternate");
        assert!(Command::new("git")
            .args(["clone", "--branch", "main"])
            .arg(&bare)
            .arg(&alternate)
            .status()
            .unwrap()
            .success());
        Command::new("git")
            .current_dir(&alternate)
            .args(["config", "user.name", "Test"])
            .status()
            .unwrap();
        Command::new("git")
            .current_dir(&alternate)
            .args(["config", "user.email", "test@example.invalid"])
            .status()
            .unwrap();
        std::fs::write(alternate.join("tracked.txt"), "remote\n").unwrap();
        Command::new("git")
            .current_dir(&alternate)
            .args(["commit", "-am", "remote"])
            .status()
            .unwrap();
        Command::new("git")
            .current_dir(&alternate)
            .args(["push"])
            .status()
            .unwrap();
        let before = repo.git(&["rev-parse", "HEAD"]);
        assert!(push(repo.path(), "origin").is_err());
        assert_eq!(repo.git(&["rev-parse", "HEAD"]), before);
        assert_eq!(
            repo.git(&["diff", "--cached", "--name-only"]).trim(),
            "tracked.txt"
        );
    }
}
