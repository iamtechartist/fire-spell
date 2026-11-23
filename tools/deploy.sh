#!/bin/sh
# Publish the page: build it, then push dist/ as one fresh commit to the gh-pages branch of this repository
# (GitHub Pages serves that branch). The source on main is not touched.
#   sh tools/deploy.sh
set -e
cd "$(dirname "$0")/.."
npm run build
if grep -q sourceMappingURL dist/assets/*.js; then echo "source maps in the build: stopping"; exit 1; fi
remote=$(git remote get-url origin)
tmp=$(mktemp -d)
cp -R dist/. "$tmp"
touch "$tmp/.nojekyll"                      # serve files as they are (no Jekyll step)
cd "$tmp"
git init -q -b gh-pages
git config user.name "$(git -C "$OLDPWD" config user.name)"
git config user.email "$(git -C "$OLDPWD" config user.email)"
git -C "$OLDPWD" config --get-all credential.https://github.com.helper | while read -r h; do git config --add credential.https://github.com.helper "$h"; done
git add -A
git commit -q -m "Publish the built page"
git push -q -f "$remote" gh-pages
cd - >/dev/null
rm -rf "$tmp"
echo "pushed dist/ to gh-pages"
