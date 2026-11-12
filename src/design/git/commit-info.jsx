/* git/commit-info.jsx — the strip under the file view's head while a commit
   is browsed: who wrote it and when, its parents (a click browses the
   parent) and the rest of the message after the subject, which the head
   already shows. A copy button takes the full sha. Data is Rust's
   CommitView (app/use-git-browser.jsx `commit`). */

const { Icon: _GCI_Icon, CopyButton: _GCI_Copy } = window;

function GitCommitInfo({ commit, onBrowse }) {
  const when = commit.at ? new Date(commit.at * 1000).toLocaleString() : "";
  return (
    <div className="gitb-commit-info">
      <div className="gitb-commit-info-meta">
        <span className="gitb-commit-info-who" title={commit.email || undefined}>{commit.author}</span>
        {when && <span className="gitb-commit-info-when">{when}</span>}
        {commit.parents.length > 0 && (
          <span className="gitb-commit-info-parents">
            <span>{commit.parents.length > 1 ? OMP_TR("parents") : OMP_TR("parent")}</span>
            {commit.parents.map(sha => (
              <button key={sha} type="button" className="gitb-sha mono" onClick={() => onBrowse?.(sha)} title={OMP_TR("browse this commit")}>
                {sha.slice(0, 7)}
              </button>
            ))}
          </span>
        )}
        <_GCI_Copy className="gitb-copy" label={OMP_TR("Copy SHA")} text={commit.id} />
      </div>
      {commit.body && <pre className="gitb-commit-info-body selectable">{commit.body}</pre>}
    </div>
  );
}

window.GitCommitInfo = GitCommitInfo;
