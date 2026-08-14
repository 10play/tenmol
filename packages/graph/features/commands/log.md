---
name: log
kind: command
category: control-flow-system
subcategory: logging
summary: Write a command (or its Python equivalent) to the currently open log file.
parity: partial
---

## Purpose
`log` appends a line to the active log file, choosing between the PyMOL-command form
and the Python form based on the current `logging` setting. It is how PyMOL records a
reproducible transcript of a session; both the GUI and scripts route logged actions
through it.

## Syntax
`log(text, alt_text=None)`

| Param | Type | Default | Meaning |
| --- | --- | --- | --- |
| `text` | str | — | the PyMOL command form (optional if `alt_text` is given) |
| `alt_text` | str | None | the Python expression form (optional) |

Both `text` and `alt_text` must include the terminating line feed.

## Behaviour
If no log file is open (`_pymol._log_file is None`), the call is a no-op. The output
depends on the `logging` setting: mode 1 (.pml) writes `text`, or `'/' + alt_text`
when only `alt_text` is given; mode 2 (.py) writes `alt_text` if present, strips a
leading `/` from `text`, or otherwise wraps it as `cmd.do(<repr>)`; mode 0 writes
nothing. The chosen text is written and the file flushed immediately. This mirrors
the C-level `PLog` implementation.

## Examples
```python
cmd.log("color red, chain A\n")
cmd.log("", "cmd.color('red', 'chain A')\n")   # python form only
```

## Related
- [log_open](log_open.md) — open the log file
- [log_close](log_close.md) — close it

## Source
`packages/engine/modules/pymol/commanding.py:160` (`def log`). Logging semantics
marked done in `docs/feature-parity.md`; registered as a no-op stub in the TS port
(`packages/engine-ts/src/cmd/extras.ts`, no log file on disk).
