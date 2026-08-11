#!/usr/bin/env bash
# Stop hook: don't end the turn to ask "shall I continue?" while work remains.
#
# Generic, task-agnostic keep-going nudge. Blocks the stop and feeds Claude a
# reason to keep working. Three ways out:
#   1. `touch .claude/STOP`            -> one-shot escape hatch; honored once then
#                                         removed, so the next turn re-arms the goal
#   2. Iteration cap (default 100)     -> runaway guard, resets on the next user prompt
#   3. Empty/absent goal               -> nothing to keep going for, allow stop
#
# The nudge text comes from (first that exists):
#   - $KEEP_GOING_REASON               (env var, full reason text)
#   - .claude/keep-going.md            (repo file, full reason text)
#   - a generic built-in default
#
# Never exits non-zero: a failing Stop hook should not wedge the session.
set -uo pipefail

ROOT="${CLAUDE_PROJECT_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"
cd "$ROOT" 2>/dev/null || exit 0

STATE_DIR=".claude/.state"
COUNT_FILE="$STATE_DIR/keep-going-count"
mkdir -p "$STATE_DIR" 2>/dev/null || exit 0

emit() { printf '%s\n' "$1"; exit 0; }

# --- opt-in -----------------------------------------------------------------
# Inert unless a goal is configured, so this stays harmless in every project.
GOAL=""
if [ -n "${KEEP_GOING_REASON:-}" ]; then
  GOAL="$KEEP_GOING_REASON"
elif [ -f ".claude/keep-going.md" ]; then
  GOAL="$(cat ".claude/keep-going.md" 2>/dev/null)"
fi
# Strip whitespace-only goals to empty.
case "$(printf '%s' "$GOAL" | tr -d '[:space:]')" in
  '') rm -f "$COUNT_FILE"; exit 0 ;;
esac

# --- escape hatch -----------------------------------------------------------
# One-shot: consume the STOP flag as we honor it, so the next turn re-arms the
# goal instead of the flag sticking around and disarming the loop forever.
if [ -f ".claude/STOP" ]; then
  rm -f "$COUNT_FILE" ".claude/STOP"
  emit '{"systemMessage":"keep-going: .claude/STOP present, honoring it once and clearing it."}'
fi

# --- runaway guard ----------------------------------------------------------
MAX="${KEEP_GOING_MAX:-${TENMOL_KEEP_GOING_MAX:-100}}"
case "$MAX" in ''|*[!0-9]*) MAX=100 ;; esac
n=$(cat "$COUNT_FILE" 2>/dev/null || echo 0)
case "$n" in ''|*[!0-9]*) n=0 ;; esac
n=$((n + 1))
printf '%s' "$n" >"$COUNT_FILE"

if [ "$n" -gt "$MAX" ]; then
  rm -f "$COUNT_FILE"
  emit "{\"systemMessage\":\"keep-going: hit the $MAX-iteration cap, allowing stop. Raise with KEEP_GOING_MAX.\"}"
fi

# --- block ------------------------------------------------------------------
REASON="Do not stop to ask whether to continue. Keep working toward the goal:

${GOAL}

Only stop when the goal is genuinely complete, or you are blocked on something that requires the user's decision. In either case say so plainly and 'touch .claude/STOP' first so this check lets you stop. (keep-going ${n}/${MAX})"

printf '%s' "$REASON" | node -e '
let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{
  process.stdout.write(JSON.stringify({decision:"block",reason:s}))
})' 2>/dev/null || emit '{"systemMessage":"keep-going: could not encode reason, allowing stop."}'
exit 0
