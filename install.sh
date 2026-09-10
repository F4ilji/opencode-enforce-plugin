#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
TARGET_DIR="${1:-.}"

echo "Installing enforce-lite plugin to $TARGET_DIR..."

mkdir -p "$TARGET_DIR/.opencode/plugins"
mkdir -p "$TARGET_DIR/.opencode/lib"
cp "$SCRIPT_DIR/plugins/enforce.js" "$TARGET_DIR/.opencode/plugins/"
cp -r "$SCRIPT_DIR/lib/enforce" "$TARGET_DIR/.opencode/lib/"
cp "$SCRIPT_DIR/package.json" "$TARGET_DIR/.opencode/"

if [ ! -f "$TARGET_DIR/.opencode/config.json" ]; then
  cp "$SCRIPT_DIR/config.default.json" "$TARGET_DIR/.opencode/config.json"
fi

if [ ! -f "$TARGET_DIR/AGENTS.md" ]; then
  cp "$SCRIPT_DIR/AGENTS.md" "$TARGET_DIR/AGENTS.md"
fi

cd "$TARGET_DIR/.opencode" && npm install --silent

echo "Enforce-Lite installed"
