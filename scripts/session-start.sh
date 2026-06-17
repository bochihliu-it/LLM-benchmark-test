#!/usr/bin/env bash
# SessionStart hook: make a fresh (e.g. Claude Code on the web) checkout runnable
# by installing dependencies. The package.json `onlyBuiltDependencies` allowlist
# ensures esbuild's native binary (needed by tsx/vitest) is built.
set -euo pipefail

cd "$(dirname "$0")/.."

if ! command -v pnpm >/dev/null 2>&1; then
  echo "session-start: pnpm not found; skipping install (install Node 22+ and pnpm 10+)." >&2
  exit 0
fi

if [ ! -d node_modules ] || [ package.json -nt node_modules ]; then
  echo "session-start: installing dependencies with pnpm..." >&2
  pnpm install --frozen-lockfile || pnpm install
else
  echo "session-start: dependencies already present." >&2
fi
