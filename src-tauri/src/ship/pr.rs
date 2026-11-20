use super::{provider_of, PrInfo};
mod cli;
mod provider;
use self::provider::{github_pr, github_repo, gitlab_pr};
use std::path::{Path, PathBuf};

const BODY_LIMIT: usize = 64 * 1024;

pub fn create_pr(repo_root: &Path, title: &str, body: &str, draft: bool) -> Result<PrInfo, String> {
    create_pr_with(
        &crate::child_path::child_path_dirs(),
        repo_root,
        title,
        body,
        draft,
    )
}

pub fn create_pr_with(
    dirs: &[PathBuf],
    repo_root: &Path,
    title: &str,
    body: &str,
    draft: bool,
) -> Result<PrInfo, String> {
    if title.trim().is_empty() {
        return Err("pull request title must not be empty".into());
    }
    if title.chars().count() > 200 {
        return Err("pull request title is too long".into());
    }
    if body.len() > BODY_LIMIT {
        return Err("pull request body is too large".into());
    }
    let (_gate, repo, work_dir) = crate::workspace::discover(repo_root)?;
    let head = repo
        .head_name()
        .map_err(|e| format!("could not read HEAD: {e}"))?
        .ok_or_else(|| "cannot create a pull request while HEAD is detached".to_string())?;
    let branch = std::str::from_utf8(head.shorten().as_ref())
        .map_err(|_| "branch name is not UTF-8".to_string())?
        .to_owned();
    let upstream = repo
        .branch_remote(head.shorten(), gix::remote::Direction::Fetch)
        .ok_or_else(|| "push the branch before creating a pull request".to_string())?
        .map_err(|e| format!("could not read upstream remote: {e}"))?;
    let url = upstream
        .url(gix::remote::Direction::Fetch)
        .or_else(|| upstream.url(gix::remote::Direction::Push))
        .ok_or_else(|| "upstream remote has no URL".to_string())?;
    match provider_of(url) {
        "github" => {
            let (owner, repository) = github_repo(url)?;
            github_pr(
                dirs,
                &work_dir,
                &branch,
                &format!("{owner}/{repository}"),
                title,
                body,
                draft,
            )
        }
        "gitlab" => gitlab_pr(dirs, &work_dir, &branch, title, body, draft),
        _ => Err("pull requests need a GitHub or GitLab remote".into()),
    }
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;
    use crate::git_browser::fixture;
    use std::os::unix::fs::PermissionsExt;

    fn repo(tag: &str, remote: &str) -> Option<fixture::Repo> {
        let repo = fixture::init(tag)?;
        repo.write("tracked", "content\n");
        repo.git(&["add", "tracked"]);
        repo.commit("initial", 1);
        repo.git(&["remote", "add", "origin", remote]);
        repo.git(&["config", "branch.main.remote", "origin"]);
        repo.git(&["config", "branch.main.merge", "refs/heads/main"]);
        Some(repo)
    }
    fn fake(dir: &Path, script: &str) {
        let path = dir.join("gh");
        std::fs::write(&path, format!("#!/bin/sh\n{script}\n")).unwrap();
        let mut perms = std::fs::metadata(&path).unwrap().permissions();
        perms.set_mode(0o755);
        std::fs::set_permissions(path, perms).unwrap();
    }

    #[test]
    fn create_uses_repo_branch_title_body_and_draft() {
        let Some(repo) = repo("ship-pr-create", "https://github.com/owner/repo.git") else {
            return;
        };
        let dir = repo.path().join("fake-bin");
        std::fs::create_dir_all(&dir).unwrap();
        let record = repo.path().join("args");
        let input = repo.path().join("body");
        fake(&dir, &format!("if [ \"$1\" = pr ] && [ \"$2\" = list ]; then echo '[]'; exit 0; fi\nprintf '%s\\n' \"$@\" > '{}'\nIFS= read -r line\nprintf '%s' \"$line\" > '{}'\necho https://github.com/owner/repo/pull/42", record.display(), input.display()));
        let got = create_pr_with(&[dir], repo.path(), "Title", "body text", true).unwrap();
        assert_eq!(
            got,
            PrInfo {
                number: 42,
                url: "https://github.com/owner/repo/pull/42".into(),
                existing: false
            }
        );
        assert_eq!(std::fs::read_to_string(input).unwrap(), "body text");
        let args = std::fs::read_to_string(record).unwrap();
        for expected in ["--draft", "--repo\nowner/repo", "--head\nmain"] {
            assert!(args.contains(expected), "{args}");
        }
    }

    #[test]
    fn existing_pr_and_signed_out_cli_are_reported() {
        let Some(repo) = repo("ship-pr-existing", "https://github.com/owner/repo.git") else {
            return;
        };
        let dir = repo.path().join("fake-bin");
        std::fs::create_dir_all(&dir).unwrap();
        let marker = repo.path().join("create-called");
        fake(&dir, &format!("if [ \"$2\" = list ]; then echo '[{{\"number\":9,\"url\":\"https://github.com/o/r/pull/9\"}}]'; else touch '{}'; fi", marker.display()));
        assert!(
            create_pr_with(std::slice::from_ref(&dir), repo.path(), "title", "", false)
                .unwrap()
                .existing
        );
        assert!(!marker.exists());
        fake(&dir, "exit 4");
        assert!(create_pr_with(&[dir], repo.path(), "title", "", false)
            .unwrap_err()
            .contains("gh auth login"));
    }

    #[test]
    fn unsupported_remote_does_not_invoke_cli() {
        let Some(repo) = repo("ship-pr-other", "https://bitbucket.org/o/r.git") else {
            return;
        };
        assert_eq!(
            create_pr_with(&[], repo.path(), "title", "", false).unwrap_err(),
            "pull requests need a GitHub or GitLab remote"
        );
    }
}
