#!/usr/bin/env bash
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
root="$(cd "$here/../../.." && pwd)"
cd "$root"
[ -d "$here/node_modules" ] || bun install --cwd "$here"
bun "$here/sync-auth.ts" >&2
export PI_CODING_AGENT_DIR="$root/tmp/pi-harness-spike/agent"
exec mise exec -- bun "$here/harness.ts"
