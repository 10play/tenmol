---
name: mdump
kind: command
category: movies-scenes-states
subcategory: movie introspection
summary: Dumps the current set of movie commands as text output.
parity: partial
---

## Purpose
`mdump` prints the movie's generalized commands (the `mdo`/`mappend` bindings per frame) as text, for inspection or debugging of a movie definition. Reach for it to see what will run on each frame.

## Syntax
`mdump()`

_No parameters._

## Behaviour
Calls `_cmd.mdump`, which writes the current frame-command table to the feedback/console output. It is read-only — it does not modify the movie definition or the image cache.

## Examples
```python
mdump
```

## Related
- [mdo](./mdo.md)
- [mset](../commands/mset.md)
- [mclear](./mclear.md)
- [mmatrix](../commands/mmatrix.md)
- [mplay](../commands/mplay.md)

## Source
`packages/engine/modules/pymol/moving.py:81`. Parity: registered as a no-op stub (returns `null`) in `packages/engine-ts/src/cmd/movie2.ts:418`.
