#!/bin/bash
# Deploy generate-campaign-content v73
# Fixes: scene images, bullet text, gradient backgrounds, repetitive content
set -e

cd "$(dirname "$0")"

echo ""
echo "=== Deploying generate-campaign-content v73 ==="
echo ""
echo "This deploys the fixed edge function with:"
echo "  1. Scene images now always generated (character_action required)"
echo "  2. Bullet/points text now always shows on cards"
echo "  3. Abstract/gradient backgrounds removed (real templates only)"
echo "  4. Better content variety"
echo ""

# Check if logged in by trying a quick API call
if ! npx supabase projects list --project-ref tpqvvrdglnsdljdpzwfl > /dev/null 2>&1; then
  echo "Not logged in to Supabase. Logging in now..."
  echo "(A browser window will open — sign in there)"
  echo ""
  npx supabase login
  echo ""
fi

echo "Deploying to project tpqvvrdglnsdljdpzwfl..."
echo ""
npx supabase functions deploy generate-campaign-content \
  --project-ref tpqvvrdglnsdljdpzwfl \
  --no-verify-jwt

echo ""
echo "=== Done! v73 is now live. ==="
echo "Create a test campaign to verify the fixes."
