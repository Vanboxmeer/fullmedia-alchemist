#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
FUNC_DIR="$SCRIPT_DIR"
PROJECT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
CLI="$FUNC_DIR/supabase_cli"
PROJECT_REF="tpqvvrdglnsdljdpzwfl"

echo "=== Fullmedia Alchemist: Deploy generate-campaign-content v67 ==="
echo ""

# Check CLI exists
if [ ! -f "$CLI" ]; then
  echo "Downloading Supabase CLI..."
  curl -fsSL -o /tmp/supabase_mac.tar.gz "https://github.com/supabase/cli/releases/latest/download/supabase_darwin_arm64.tar.gz"
  tar xzf /tmp/supabase_mac.tar.gz -C "$FUNC_DIR"
  mv "$FUNC_DIR/supabase" "$CLI"
  rm -f /tmp/supabase_mac.tar.gz
fi

chmod +x "$CLI"

# Check if logged in
if ! "$CLI" projects list --project-ref "$PROJECT_REF" > /dev/null 2>&1; then
  echo "Not logged in. Run this first:"
  echo "  $CLI login"
  echo ""
  echo "Then re-run this script."
  exit 1
fi

echo "Deploying from: $FUNC_DIR"
echo "Files: index.ts (v67), hashtags.ts"
echo ""

cd "$PROJECT_DIR"
"$CLI" functions deploy generate-campaign-content --project-ref "$PROJECT_REF"

echo ""
echo "=== Deploy complete! v67 is now live. ==="
