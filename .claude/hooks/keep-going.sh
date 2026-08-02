#!/usr/bin/env bash
# Stop hook: don't end the turn to ask "shall I continue?" while parity work remains.
#
# Blocks the stop and feeds Claude the remaining work as a reason. Three ways out:
#   1. Parity reaches 0 open rows      -> the work is actually done
#   2. `touch .claude/STOP`            -> manual escape hatch
#   3. Iteration cap (default 100)     -> runaway guard, resets on the next user prompt
#
# Never exits non-zero: a failing Stop hook should not wedge the session.
set -uo pipefail

ROOT="${CLAUDE_PROJECT_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"
cd "$ROOT" 2>/dev/null || exit 0

# Installed in USER settings so it loads without a session restart, which means
# it fires in every project. Inert anywhere that is not this repo.
[ -f "scripts/parity.mjs" ] && [ -f "docs/00-parity-inventory.md" ] || exit 0

STATE_DIR=".claude/.state"
COUNT_FILE="$STATE_DIR/keep-going-count"
mkdir -p "$STATE_DIR" 2>/dev/null || exit 0

emit() { printf '%s\n' "$1"; exit 0; }

# --- escape hatch -----------------------------------------------------------
if [ -f ".claude/STOP" ]; then
  rm -f "$COUNT_FILE"
  emit '{"systemMessage":"keep-going: .claude/STOP present, allowing stop."}'
fi

# --- runaway guard ----------------------------------------------------------
MAX="${TENMOL_KEEP_GOING_MAX:-100}"
n=$(cat "$COUNT_FILE" 2>/dev/null || echo 0)
case "$n" in ''|*[!0-9]*) n=0 ;; esac
n=$((n + 1))
printf '%s' "$n" >"$COUNT_FILE"

if [ "$n" -gt "$MAX" ]; then
  rm -f "$COUNT_FILE"
  emit "{\"systemMessage\":\"keep-going: hit the $MAX-iteration cap, allowing stop. Raise with TENMOL_KEEP_GOING_MAX.\"}"
fi

# --- done condition ---------------------------------------------------------
PARITY=$(node scripts/parity.mjs --json 2>/dev/null) || emit '{"systemMessage":"keep-going: parity check failed to run, allowing stop."}'
[ -n "$PARITY" ] || emit '{"systemMessage":"keep-going: parity check returned nothing, allowing stop."}'

read -r OPEN PARTIAL DONE TOTAL <<EOF
$(printf '%s' "$PARITY" | node -e '
let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{
  try{const t=JSON.parse(s).totals;process.stdout.write(`${t.open} ${t.partial} ${t.done} ${t.total}`)}
  catch{process.stdout.write("")}
})' 2>/dev/null)
EOF

case "${OPEN:-}" in ''|*[!0-9]*) emit '{"systemMessage":"keep-going: could not parse parity totals, allowing stop."}' ;; esac

if [ "$OPEN" -eq 0 ] && [ "${PARTIAL:-0}" -eq 0 ]; then
  rm -f "$COUNT_FILE"
  emit "{\"systemMessage\":\"keep-going: all $TOTAL parity rows done. Allowing stop.\"}"
fi

# --- block ------------------------------------------------------------------
REASON="Do not stop to ask whether to continue. ${OPEN} of ${TOTAL} parity rows are still open (${DONE} done, ${PARTIAL} partial).

Pick up the next work package from docs/03-implementation-plan.md section 6 and implement it. Respect the file-ownership boundaries there; run 'pnpm ownership' if unsure who owns a file.

Before finishing a package: pnpm typecheck && pnpm build && pnpm lint, plus the bridge suite (packages/bridge/.venv/bin/python -m pytest packages/bridge/tests -q) and pnpm test. Tick the rows you genuinely verified in docs/00-parity-inventory.md so this check advances -- do not tick rows you did not test.

Only stop if you are blocked on something that genuinely requires the user's decision, in which case say so plainly and touch .claude/STOP first. (keep-going ${n}/${MAX})"

printf '%s' "$REASON" | node -e '
let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{
  process.stdout.write(JSON.stringify({decision:"block",reason:s}))
})' 2>/dev/null || emit '{"systemMessage":"keep-going: could not encode reason, allowing stop."}'
exit 0
