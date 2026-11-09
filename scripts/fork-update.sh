#!/usr/bin/env bash
# fork-update.sh — keep this fork current with upstream and reinstall it.
#
#   scripts/fork-update.sh            merge upstream, test, build, install
#   scripts/fork-update.sh --no-merge build + install the current checkout only
#   scripts/fork-update.sh --push     also push the branch to origin afterwards
#
# Steps: refuse a dirty tree → fetch `upstream` → merge upstream/master into
# the current branch (a conflict aborts the merge, leaving the tree as it was)
# → npm test → release build without bundles → install the binary to
# $OMP_FORK_BIN (default ~/.local/opt/omp-desktop/omp-desktop), which the
# desktop menu entry runs. The running app keeps its old binary until restart.
set -euo pipefail

MERGE=1 PUSH=0
for a in "$@"; do
  case "$a" in
    --no-merge) MERGE=0 ;;
    --push) PUSH=1 ;;
    -h|--help) sed -n 2,13p "$0"; exit 0 ;;
    *) echo "unknown option: $a" >&2; exit 2 ;;
  esac
done

ROOT=$(cd "$(dirname "$0")/.." && pwd)
BIN=${OMP_FORK_BIN:-$HOME/.local/opt/omp-desktop/omp-desktop}
cd "$ROOT"
branch=$(git rev-parse --abbrev-ref HEAD)

if [ -n "$(git status --porcelain --untracked-files=no)" ]; then
  echo "✗ uncommitted changes on $branch: commit or stash them first" >&2
  exit 1
fi

if [ "$MERGE" = 1 ]; then
  git remote get-url upstream >/dev/null 2>&1 || git remote add upstream https://github.com/apoc/omp-desktop.git
  git fetch --tags upstream
  behind=$(git rev-list --count HEAD..upstream/master)
  if [ "$behind" = 0 ]; then
    echo "• already up to date with upstream/master"
  else
    echo "• merging $behind upstream commit(s) into $branch"
    lock_before=$(git rev-parse HEAD:package-lock.json 2>/dev/null || true)
    if ! git merge --no-edit upstream/master; then
      git merge --abort
      echo "✗ merge conflict with upstream: nothing changed. Resolve by hand (git merge upstream/master) or ask an agent." >&2
      exit 1
    fi
    [ "$(git rev-parse HEAD:package-lock.json 2>/dev/null || true)" = "$lock_before" ] || npm ci
  fi
fi

[ -d node_modules ] || npm ci
echo "• tests"
npm test >/tmp/omp-fork-test.log 2>&1 || { tail -30 /tmp/omp-fork-test.log; echo "✗ tests failed (full log: /tmp/omp-fork-test.log)" >&2; exit 1; }

echo "• release build"
# --no-bundle: only the binary. Bundles would also need the updater signing key.
npm run build -- --no-bundle

install -d "$(dirname "$BIN")"
install -m 755 src-tauri/target/release/omp-desktop "$BIN.new"
mv -f "$BIN.new" "$BIN"
echo "✓ installed $(git describe --tags --always) → $BIN (restart the app to use it)"

if [ "$PUSH" = 1 ]; then git push origin "$branch"; fi
