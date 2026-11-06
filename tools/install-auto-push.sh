#!/bin/bash
# One-time setup: your Mac checks every minute and pushes new commits to GitHub.
set -e
REPO="$(cd "$(dirname "$0")/.." && pwd)"
PL="$HOME/Library/LaunchAgents/com.fullmedia.autopush.plist"
LOG="$HOME/Library/Logs/fma-auto-push.log"
mkdir -p "$HOME/Library/LaunchAgents" "$HOME/Library/Logs"
cat > "$PL" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>Label</key><string>com.fullmedia.autopush</string>
<key>ProgramArguments</key><array><string>/bin/bash</string><string>$REPO/tools/auto-push.sh</string><string>$REPO</string></array>
<key>StartInterval</key><integer>60</integer>
<key>RunAtLoad</key><true/>
<key>StandardErrorPath</key><string>$LOG</string>
</dict></plist>
PLIST
launchctl bootout "gui/$(id -u)" "$PL" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$PL"
bash "$REPO/tools/auto-push.sh" "$REPO"
echo ""
echo "Done. Your Mac now pushes new commits to GitHub by itself every minute."
echo "Recent activity:"; tail -4 "$LOG" 2>/dev/null || echo "(nothing yet)"
