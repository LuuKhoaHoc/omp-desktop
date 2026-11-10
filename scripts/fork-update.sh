#!/usr/bin/env bash
# fork-update.sh — bring upstream (apoc/omp-desktop) into this fork, then reinstall.
#
#   scripts/fork-update.sh --check     what upstream brings and where it collides; changes no branch but master
#   scripts/fork-update.sh             merge upstream on a sync branch in its own worktree, then test it
#   scripts/fork-update.sh --install   test + release build + install the CURRENT checkout (old --no-merge)
#   add --push                         push the green sync branch to origin
#
# Branch model: `master` mirrors upstream (fast-forwarded here, never fork
# commits), `develop` = master + fork work. The merge runs on
# `sync/upstream-<sha>` in .worktrees/, so the main checkout (often dirty,
# maybe running `tauri dev`) is never touched. A conflict stays in that
# worktree; .git/fork-sync-report.md lists, per file, the fork and upstream
# commits that touched it, plus the cross-file contracts upstream changed.
# Rerun after committing the resolution: it tests the branch and prints the
# merge into develop, which stays yours to run.
set -euo pipefail

MODE=sync PUSH=0
for a in "$@"; do
  case "$a" in
    --check) MODE=check ;;
    --install | --no-merge) MODE=install ;;
    --push) PUSH=1 ;;
    -h | --help) sed -n 2,17p "$0"; exit 0 ;;
    *) echo "unknown option: $a" >&2; exit 2 ;;
  esac
done

ROOT=$(cd "$(dirname "$0")/.." && pwd)
BIN=${OMP_FORK_BIN:-$HOME/.local/opt/omp-desktop/omp-desktop}
FORK=${OMP_FORK_BRANCH:-develop}
UP=upstream/master
cd "$ROOT"
REPORT=$(git rev-parse --path-format=absolute --git-common-dir)/fork-sync-report.md
LOG=${TMPDIR:-/tmp}/omp-fork-test.log

run_tests() { # $1 = checkout
  echo "• tests in $1"
  (cd "$1" && { [ -d node_modules ] || npm ci; } && npm test >"$LOG" 2>&1) || {
    tail -30 "$LOG"; echo "✗ tests failed in $1 (log: $LOG)" >&2; return 1; }
}

if [ "$MODE" = install ]; then
  n=$(git status --porcelain --untracked-files=no | wc -l)
  [ "$n" = 0 ] || echo "! building with $n uncommitted file(s) on $(git branch --show-current)"
  run_tests "$ROOT"
  echo "• release build"
  # --no-bundle: only the binary. Bundles would also need the updater signing key.
  npm run build -- --no-bundle
  install -d "$(dirname "$BIN")"
  install -m 755 src-tauri/target/release/omp-desktop "$BIN.new"
  mv -f "$BIN.new" "$BIN"
  echo "✓ installed $(git describe --tags --always --dirty) → $BIN (restart the app to use it)"
  exit 0
fi

git remote get-url upstream >/dev/null 2>&1 || git remote add upstream https://github.com/apoc/omp-desktop.git
git fetch --tags upstream

if ! git merge-base --is-ancestor master "$UP"; then
  echo "! master has commits upstream lacks: not moved (it should only mirror upstream)" >&2
elif grep -qx 'branch refs/heads/master' <<<"$(git worktree list --porcelain)"; then
  echo "• master is checked out in a worktree: not moved"
else
  git update-ref refs/heads/master "$(git rev-parse "$UP")"
fi

SYNC=sync/upstream-$(git rev-parse --short "$UP")
WT=$ROOT/.worktrees/${SYNC//\//-}
behind=$(git rev-list --count "$FORK..$UP")
if [ "$behind" = 0 ] && [ ! -d "$WT" ]; then echo "✓ $FORK already has everything from $UP"; exit 0; fi

# ── Report ─────────────────────────────────────────────────────────────
if [ ! -d "$WT" ]; then
  base=$(git merge-base "$FORK" "$UP")
  up_files=$(git diff --name-only "$FORK...$UP")
  conflicts=$(git merge-tree --write-tree --name-only --no-messages "$FORK" "$UP" | tail -n +2 || true)
  {
    echo "# Upstream sync: $FORK ← $UP $(git rev-parse --short "$UP") ($behind commits)"
    echo; echo '## Upstream commits'; echo
    git log --reverse --format='- %h %s' "$FORK..$UP"
    echo; echo '## Predicted conflicts'; echo
    [ -n "$conflicts" ] || echo 'none'
    for f in $conflicts; do
      echo "- \`$f\`"
      git log -5 --format='  - fork %h %s' "$base..$FORK" -- "$f"
      git log -5 --format='  - upstream %h %s' "$FORK..$UP" -- "$f"
    done
    # AGENTS.md's cross-file contracts: a merge can keep both sides of these
    # textually and still break them, so they need a look even without a conflict.
    echo; echo '## Contracts upstream touched'; echo
    echo "$up_files" | grep -E '^(src-tauri/src/agent/(spawn|mod)\.rs|src-tauri/src/keybindings/mod\.rs|src/app/keymap\.js|src/index\.html|src/live\.js|package(-lock)?\.json|src-tauri/Cargo\.(toml|lock)|src-tauri/tauri[a-z.]*\.json|AGENTS\.md)$' |
      sed 's/^/- /' || echo 'none'
    git diff "$FORK...$UP" -- src-tauri/src/agent/spawn.rs | grep -E '^\+const MIN_OMP_VERSION' | sed 's/^+/- omp floor raised: /' || true
    dirty=$(comm -12 <(echo "$up_files" | sort) <(git status --porcelain | cut -c4- | sort))
    if [ -n "$dirty" ]; then
      echo; echo "## Uncommitted in $ROOT and changed upstream"; echo
      echo "The sync branch starts from committed $FORK; commit these first or redo them after merging:"
      echo "$dirty" | sed 's/^/- /'
    fi
  } >"$REPORT"
  cat "$REPORT"
fi
[ "$MODE" = check ] && { echo; echo "(report: $REPORT)"; exit 0; }

# ── Merge on the sync branch, in its own worktree ──────────────────────
if [ -d "$WT" ]; then
  echo "• continuing in $WT"
  cd "$WT"
  if git rev-parse -q --verify MERGE_HEAD >/dev/null; then
    echo "✗ merge still in progress in $WT: resolve, git commit, rerun" >&2; exit 3
  fi
else
  git worktree add -b "$SYNC" "$WT" "$FORK"
  cd "$WT"
  if ! git merge --no-edit "$UP"; then
    echo >&2
    echo "✗ conflicts left in $WT (branch $SYNC); per-file history in $REPORT." >&2
    echo "  Keep the fork's layout and take upstream's features, git commit, rerun." >&2
    exit 3
  fi
fi
git merge-base --is-ancestor "$UP" HEAD || { echo "✗ $SYNC does not contain $UP" >&2; exit 3; }

run_tests "$WT"
[ "$PUSH" = 1 ] && git push -u origin "$SYNC"
echo "✓ $SYNC is green. In $ROOT on $FORK:"
echo "    git merge --no-ff $SYNC && scripts/fork-update.sh --install"
echo "    git worktree remove $WT && git branch -d $SYNC"
