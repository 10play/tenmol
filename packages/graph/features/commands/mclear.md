---
name: mclear
kind: command
category: movies-scenes-states
subcategory: movie cache
summary: Clears the movie frame image cache.
parity: implemented
---

## Purpose
`mclear` empties the cached rendered images that back movie playback. Reach for it to free memory after building a ray-traced movie, or to force frames to be re-rendered after you change the scene.

## Syntax
`mclear()`

_No parameters._

## Behaviour
Calls `_cmd.mclear`, discarding all frame images held in the movie cache. It does not alter the movie definition (frame→state mapping) or the generalized `mdo`/`mappend` commands — only the pre-rendered image cache is dropped, so the next play re-renders frames.

## Examples
```python
mclear
```

## Related
- [mset](../commands/mset.md)
- [mdo](./mdo.md)
- [mplay](../commands/mplay.md)
- [mmatrix](../commands/mmatrix.md)

## Source
`packages/engine/modules/pymol/moving.py:436`. Parity: implemented in `packages/engine-ts/src/cmd/system.ts:186` (clears the in-memory movie frames).
