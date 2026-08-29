#!/usr/bin/env bash
# Build the demo site and push it to the Forgejo Pages branch.
set -e

ROOT=$(cd "$(dirname "$0")/.." && pwd)
cd "$ROOT"

echo "Building @fiduswriter/document..."
npm run build

echo "Preparing pages build..."
BUILD_DIR="$ROOT/.pages-build"
rm -rf "$BUILD_DIR"
mkdir "$BUILD_DIR"

cp -r "$ROOT/demo/"* "$BUILD_DIR/"
cp -r "$ROOT/dist" "$BUILD_DIR/"

# Bundle demo entry points into the pages build.
echo "Bundling demos..."
PAGES_BUILD_DIR="$BUILD_DIR" node "$ROOT/scripts/build-demo.js"

# Copy fwtoolkit CSS and the document export stylesheet (with its bundled
# Libertinus fallback fonts) so the demo has consistent styling without a CDN.
mkdir -p "$BUILD_DIR/css"
cp "$ROOT/node_modules/fwtoolkit/css/fwtoolkit.css" "$BUILD_DIR/css/"
cp -r "$ROOT/css/." "$BUILD_DIR/css/document/"

# Remove TypeScript sources and declaration/source-map files from the pages build.
find "$BUILD_DIR" -name "*.ts" -delete
find "$BUILD_DIR/dist" \( -name "*.d.ts" -o -name "*.map" \) -delete

cd "$BUILD_DIR"
git init
git checkout -b pages
git add .
# A committer identity is required when running in CI (fresh runner image).
git config user.name "CI"
git config user.email "ci@fiduswriter.org"
git commit -m "Deploy @fiduswriter/document demo to Forgejo Pages"

# Prefer the HTTPS push URL passed from CI (org-level PAGES_TOKEN); fall back
# to the locally configured SSH remote for manual deploys.
if [ -n "${PAGES_REMOTE:-}" ]; then
    REMOTE="$PAGES_REMOTE"
    echo "Pushing to pages branch via CI token..."
else
    REMOTE=$(cd "$ROOT" && git remote get-url origin)
    echo "Pushing to $REMOTE pages branch..."
fi
git remote add origin "$REMOTE"
git push -f origin pages

cd "$ROOT"
rm -rf "$BUILD_DIR"
echo "Done. The demo should be available at https://fiduswriter.pages.fiduswriter.org/fiduswriter-document-ts/"
