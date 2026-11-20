/* Pure, user-facing summaries for Rust/Git worktree errors. Keep the original
   detail alongside the summary so an unfamiliar failure is never hidden. */
(function () {
  const knownErrors = [
    [/git (?:was not found|not found)|git executable not found/i, "Git could not be found. Install Git or add it to PATH."],
    [/not a git repository|could not resolve repository root|failed to canonicalize repository root/i, "This folder is not a usable Git repository."],
    [/permission denied|access is denied|operation not permitted/i, "Git does not have permission to access this path."],
    [/already checked out|is already checked out/i, "That branch is already checked out in another worktree."],
    [/already exists|file exists/i, "A file or folder at that path already exists."],
    [/worktree.*(?:locked|is locked)|(?:locked|is locked).*worktree/i, "This worktree is locked and cannot be changed."],
  ];

  function present(error) {
    const detail = String(error?.message ?? error ?? "");
    const match = knownErrors.find(([pattern]) => pattern.test(detail));
    return {
      message: match?.[1] ?? "The Git or worktree operation failed.",
      detail: detail || "No error details were provided.",
    };
  }

  window.OMP_GIT_ERROR = { present };
})();
