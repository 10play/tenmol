---
name: keep-going
description: Arm, update, or disarm the keep-going loop — a Stop hook that refuses to end the turn while a configured goal is unfinished, so Claude works autonomously toward it instead of stopping to ask "shall I continue?". Use when the user wants Claude to keep going on a task without check-ins, or wants to stop/change an active keep-going goal.
---

# keep-going

Drives the Stop hook at `.claude/hooks/keep-going.sh`. That hook blocks the end of a
turn and feeds Claude a "keep working toward the goal" nudge whenever a goal is
configured — so Claude runs a task to completion instead of stopping to ask for
permission to continue. This skill is how you arm, update, and disarm it.

The goal lives in **`.claude/keep-going.md`** (the hook also honors a `$KEEP_GOING_REASON`
env var, but the file is what this skill manages). With no goal set, the hook is inert and
turns end normally.

## Arm it (set / replace the goal)

Take the goal from the user's request (the args to this skill, or the surrounding ask) and
write it to `.claude/keep-going.md`. Make the goal **concrete and testable** — the hook
replays this text on every stop, so it should state what "done" looks like, e.g.
"Ship the auth refactor: all endpoints migrated, `pnpm test` green, PR opened." Vague goals
("improve things") make the loop unable to recognize completion.

```
mkdir -p .claude
cat > .claude/keep-going.md <<'EOF'
<the concrete goal + its done-condition>
EOF
rm -f .claude/STOP .claude/.state/keep-going-count   # clear any prior stop / counter
```

Then confirm to the user: what the goal is, that the loop is armed, and how to stop it.

## Disarm it (finish / cancel)

Two ways, pick per intent:

- **Goal is genuinely done, or the user wants to cancel**: clear the goal so the hook goes
  inert — `rm -f .claude/keep-going.md .claude/.state/keep-going-count`.
- **One-shot escape hatch** (stop this turn but keep the goal around): `touch .claude/STOP`.
  The hook honors it on the next stop and then deletes `.claude/STOP` itself, so it truly is
  one-shot — the goal file stays and the loop re-arms on the following turn, no retyping.

When *you* (Claude) decide the goal is complete or you're blocked on a real user decision,
`touch .claude/STOP` and say so plainly — that is the sanctioned way for the loop to end.

## Tuning

- **Iteration cap** — runaway guard, default 100 stops per turn. Override with
  `KEEP_GOING_MAX` (or legacy `TENMOL_KEEP_GOING_MAX`). The counter resets on each new user
  prompt via the `UserPromptSubmit` reset hook, so the cap is per-turn.
- **Inspect state** — `cat .claude/keep-going.md` (current goal),
  `cat .claude/.state/keep-going-count` (stops so far this turn).

## Notes

- The hook never exits non-zero — a failure just allows the stop, so a broken loop can't
  wedge the session.
- The hooks are wired in `.claude/settings.local.json` (`Stop` → keep-going, plus
  `UserPromptSubmit` → keep-going-reset). If the loop isn't firing, check those are present.
