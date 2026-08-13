---
name: log_close
kind: command
category: control-flow-system
subcategory: logging
summary: Close the currently open log file and turn logging off.
parity: partial
---

## Purpose
`log_close` finishes a logging session started with [log_open](log_open.md): it
closes the open log file handle and resets the `logging` setting to 0. Call it when
you are done recording a transcript.

## Syntax
`log_close()`

Takes no user arguments (internal `_self=cmd`).

## Behaviour
If `_pymol._log_file` exists and is not None, its handle is closed and deleted, the
`logging` setting is set to 0, and (subject to the feedback mask) a "log closed"
message is printed. If no log file is open, the call does nothing. Idempotent — safe
to call when no log is active.

## Examples
```text
log_open session.pml
color red, chain A
log_close
```

## Related
- [log_open](log_open.md) — open a log file
- [log](log.md) — write a line to it

## Source
`packages/engine/modules/pymol/commanding.py:206` (`def log_close`). Logging
semantics marked done in `docs/feature-parity.md`; registered as a no-op stub in the
TS port (`packages/engine-ts/src/cmd/extras.ts`).
