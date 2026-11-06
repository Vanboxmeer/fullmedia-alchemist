#!/bin/bash
# Sends new commits on main to GitHub, so the site and functions deploy by themselves.
# Run by launchd every minute (see install-auto-push.sh). Never forces, never changes files.
export PATH="/usr/bin:/bin:/usr/local/bin:/opt/homebrew/bin:$PATH"
export GIT_TERMINAL_PROMPT=0
REPO="${1:-$(cd "$(dirname "$0")/.." && pwd)}"
LOG="$HOME/Library/Logs/fma-auto-push.log"
cd "$REPO" || exit 0
[ -e .git/index.lock ] && exit 0
[ "$(git rev-parse --abbrev-ref HEAD 2>/dev/null)" = "main" ] || exit 0
git fetch -q origin main 2>>"$LOG" || { echo "$(date) fetch failed (sign-in?)" >>"$LOG"; exit 0; }
ahead=$(git rev-list --count origin/main..main 2>/dev/null || echo 0)
behind=$(git rev-list --count main..origin/main 2>/dev/null || echo 0)
[ "$ahead" -gt 0 ] || exit 0
if [ "$behind" -gt 0 ]; then echo "$(date) not pushing: ahead $ahead, behind $behind (needs a look)" >>"$LOG"; exit 0; fi
if git push -q origin main >>"$LOG" 2>&1; then echo "$(date) pushed $ahead commit(s)" >>"$LOG"; else echo "$(date) push failed" >>"$LOG"; fi
