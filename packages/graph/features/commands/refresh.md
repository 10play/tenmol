---
name: refresh
kind: command
category: rendering-export
subcategory: redraw
summary: Redraw the scene as soon as the operating system allows.
parity: implemented
---

## Purpose
`refresh` requests an immediate scene redraw. Reach for it in scripts to force the
viewport to update mid-sequence (e.g. before capturing an image or after a batch
of changes) without rebuilding geometry.

## Syntax
```
refresh
```
Takes no arguments.

## Behaviour
If called on the GUI thread it calls `_refresh` directly; otherwise it queues
`_ cmd._refresh()` under the command lock so the redraw happens on the correct
thread. It only redraws existing geometry — it does not recreate it (use
`rebuild` for that).

## Examples
```
refresh
```

## Related
- [rebuild](../commands/rebuild.md)

## Source
`packages/engine/modules/pymol/viewing.py:1750` (`def refresh`). Parity:
implemented in `packages/engine-ts/src/cmd/extras.ts:463`.
