---
name: ending
kind: command
category: movies-scenes-states
subcategory: movie navigation
summary: Jumps the movie to its last frame.
parity: implemented
---

## Purpose
`ending` moves the movie playhead to the end (final frame). It is the counterpart of `rewind`/`middle` for quickly navigating a defined movie.

## Syntax
`ending()`

This command takes no user-facing arguments.

## Behaviour
Locks the API and calls `_cmd.set_frame(COb, 6, 0)` — frame-set mode 6 meaning "go to the last frame". It raises `CmdException` on error when raising is enabled and otherwise just repositions the current frame.

## Examples
```python
ending    # jump to the last movie frame
```

## Related
- [rewind](../commands/rewind.md)
- [middle](../commands/middle.md)
- [frame](../commands/frame.md)
- [mplay](../commands/mplay.md)

## Source
`packages/engine/modules/pymol/moving.py:911`. Parity: implemented as a no-op frame signal in `packages/engine-ts/src/cmd/controlflow.ts:204`.
