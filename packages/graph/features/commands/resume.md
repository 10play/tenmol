---
name: resume
kind: command
category: control-flow-system
subcategory: logging
summary: Replays an existing log file and reopens it in append mode for continued recording.
parity: planned
---

## Purpose
`resume` picks up a previous logging session: it executes the commands already in a log file and then reopens that same file for appending, so new commands continue to be recorded. Use it to continue building on a `.pml`/`.py` log you started earlier.

## Syntax
`resume(filename)`

| Param | Type | Default | Meaning |
| --- | --- | --- | --- |
| `filename` | string | — | path to the existing log file to replay and reopen |

## Behaviour
If the file exists, `resume` runs it — `run <file>` for `.py`/`.pym` scripts, otherwise `@<file>` for `.pml`-style command files — and then calls `log_open(filename, a)` to append further commands. If the file does not exist nothing is replayed. This is the "continue" analogue to [log_open](../commands/log_open.md), which starts fresh.

## Examples
```python
resume session.pml
resume analysis.py
```

## Related
- [log](../commands/log.md)
- [log_open](../commands/log_open.md)
- [log_close](../commands/log_close.md)

## Source
`packages/engine/modules/pymol/commanding.py:52`; signature in `docs/api-reference/commands.mdx:3267`. Parity: registered as a no-op stub in `packages/engine-ts/src/cmd/extras.ts` (disk logging unavailable); planned.
