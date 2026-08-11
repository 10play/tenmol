#!/usr/bin/env bash
# UserPromptSubmit hook: reset the keep-going iteration counter on each new user
# turn, so the runaway cap is per-turn rather than cumulative over the session.
# Never exits non-zero.
set -uo pipefail
ROOT="${CLAUDE_PROJECT_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"
rm -f "$ROOT/.claude/.state/keep-going-count" 2>/dev/null || true
exit 0
