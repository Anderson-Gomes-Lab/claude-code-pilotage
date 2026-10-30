#!/bin/bash
# Checks of the mod. Fast by default (tests, manifest); `complet` adds types, lint, dead code and duplication (tools in dev/).
set -u
cd "$(dirname "$0")/.." || exit 1

# The view tests need $.ui.mount: an older Claude Code passes them without drawing anything, so it is refused.
MINIMUM=2.1.309
moteur=${CLAUDE_BIN:-$(ls -d "$HOME/Library/Application Support/Claude/claude-code"/*/*/claude.app/Contents/MacOS/claude 2>/dev/null | sort -V | tail -1)}
moteur=${moteur:-claude}
version=$("$moteur" --version </dev/null | cut -d' ' -f1)
if [ "$(printf '%s\n%s\n' "$MINIMUM" "$version" | sort -V | head -1)" != "$MINIMUM" ]; then
  echo "Claude Code $version cannot draw the views: $MINIMUM or newer needed (set CLAUDE_BIN)"
  exit 1
fi

etape() {
  echo "— $1"; shift
  sortie=$("$@" </dev/null 2>&1) && { echo "$sortie" | tail -3; return; }
  echo "$sortie"; echo "FAILED"; exit 1
}

etape "tests ($version)" "$moteur" plugin test .
etape "manifest" "$moteur" plugin validate .
[ "${1:-}" = complet ] || exit 0

outil=dev/node_modules/.bin
[ -x "$outil/eslint" ] || { echo "run: npm ci --prefix dev"; exit 1; }
[ -f .claude-plugin/types/tsconfig.json ] || { echo "no types: load the mod once (claude --plugin-dir .), the engine writes them"; exit 1; }
etape "types" "$outil/tsc" -p .
etape "lint" "$outil/eslint" --config dev/eslint.config.mjs hooks
etape "dead code" node dev/exports.mjs
etape "duplication" "$outil/jscpd" hooks --min-lines 5 --threshold 0 --silent
