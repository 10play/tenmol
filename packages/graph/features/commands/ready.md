---
name: ready
kind: command
category: internal
subcategory: engine state
summary: Internal predicate reporting whether the PyMOL engine has finished initializing.
parity: internal
---

## Purpose
`ready` is an internal routine that reports whether the PyMOL core has finished
starting up. It is used by launch/monitoring code to gate work until the engine
is live; it is not a user-facing command.

## Syntax
```
ready()
```
Takes no user arguments.

## Behaviour
Marked `# INTERNAL` with a "subject to change" warning in the source. Returns the
result of `_cmd.ready`, a truthiness flag for engine readiness. Do not rely on it
in scripts.

## Related
- [reinitialize](../commands/reinitialize.md)

## Source
`packages/engine/modules/pymol/monitoring.py` (`def ready` — INTERNAL). Parity:
readiness handled in `packages/engine-ts/src/backend.ts`.
