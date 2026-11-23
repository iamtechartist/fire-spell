#!/bin/sh
# The backup: one zip of the whole project folder. It leaves out what can be rebuilt (node_modules, dist)
# and never carries a video: demo films are handed over as their own files.
#   sh release.sh   ->  ../fire-spell-COMPLETE.zip
set -e
cd "$(dirname "$0")/.."
zip -r -FS -q fire-spell-COMPLETE.zip fire-spell \
  -x 'fire-spell/node_modules/*' 'fire-spell/dist/*' 'fire-spell/demo/*' \
     '*.mp4' '*.mov' '*.webm' '*.mkv' '*.gif' '*.DS_Store'
echo "videos inside (must be 0): $(unzip -l fire-spell-COMPLETE.zip | grep -ciE '\.(mp4|mov|webm|mkv|gif)$' || true)"
ls -la fire-spell-COMPLETE.zip
