---
name: log_open
kind: command
category: control-flow-system
subcategory: logging
summary: Open a log file for writing, selecting .pml or .py logging mode from the filename extension.
parity: partial
---

## Purpose
`log_open` starts a logging session by opening a file to which subsequent commands
are transcribed via [log](log.md). The extension decides whether the transcript is
recorded as PyMOL commands (`.pml`) or Python (`.py`/`.pym`), so the resulting file
can be replayed with `@` or `run`.

## Syntax
`log_open(filename='log.pml', mode='w')`

| Param | Type | Default | Meaning |
| --- | --- | --- | --- |
| `filename` | str | `'log.pml'` | file to write to (.pml or .py) |
| `mode` | w/a | `'w'` | `w` to open an empty log, `a` to append |

## Behaviour
Any previously open log is closed first. A `.py`/`.PY`/`.pym`/`.PYM` filename sets
the `logging` setting to 2 (Python mode); anything else sets it to 1 (pml mode).
Append mode (`a`) writes a leading newline so appended content starts on a fresh
line. If `filename` is not a string, PyMOL logs into an in-memory `QueueFile` instead
of a disk file (still setting logging to 1). `LogFile.write` rewrites any `fetch ...`
line to append `async=0` so replays are deterministic. Failure to open prints an
error, sets logging to 0 and raises `QuietException`.

## Examples
```text
log_open session.pml
log_open script.py
log_open notes.pml, a
```

## Related
- [log](log.md) — write lines to the open log
- [log_close](log_close.md) — close the log

## Source
`packages/engine/modules/pymol/commanding.py:107` (`def log_open`). Logging semantics
marked done in `docs/feature-parity.md`; the File menu Log Open/Append handlers call
it. Registered as a no-op stub in the TS port
(`packages/engine-ts/src/cmd/extras.ts`).
