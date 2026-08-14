---
name: get_frame
kind: command
category: movies-scenes-states
subcategory: movie navigation
summary: Returns the current movie frame index (1-based).
parity: implemented
---

## Purpose
`get_frame` returns the index of the current movie frame. Frames are the movie timeline positions; they may map one-to-one to molecular states (the default) or via an arbitrary `mset` mapping. Use it to read playback position.

## Syntax
`get_frame()`

Takes no positional arguments (only the internal `_self`).

## Behaviour
Returns a 1-based integer frame index directly from `_cmd.get_frame`. Notably it takes **no lock** because it can be called from within `cmd.refresh()`. Contrast with `get_state`, which returns the molecular coordinate state.

## Examples
```python
f = cmd.get_frame()
```

## Related
- [get_state](../commands/get_state.md)
- [frame](../commands/frame.md)
- [get_movie_length](./get_movie_length.md)

## Source
`packages/engine/modules/pymol/moving.py:984`. Parity: implemented in `packages/engine-ts/src/cmd/system.ts`; return type mapped to `number`.
