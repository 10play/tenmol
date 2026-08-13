---
name: backward
kind: command
category: movies-scenes-states
subcategory: movie playback
summary: Steps the movie back one frame.
parity: implemented
---

## Purpose
`backward` moves the movie playhead back a single frame. It is the reverse counterpart to `forward`, used to step through an animation frame by frame.

## Syntax
`backward()` — takes no arguments.

## Behaviour
Under the API lock it calls `_cmd.set_frame(_COb, 5, -1)` — mode `5` with a relative offset of `-1`, i.e. decrement the current frame by one. It operates on the movie frame index only; it does not alter object states directly except through the movie's frame-to-state mapping. Raises `pymol.CmdException` on failure when raising is enabled.

## Examples
```python
backward
cmd.backward()
```

## Related
- [forward](../commands/forward.md)
- [rewind](../commands/rewind.md)
- [mset](../commands/mset.md)

## Source
`packages/engine/modules/pymol/moving.py:846`. Parity: implemented in `packages/engine-ts/src/cmd/system.ts`.
