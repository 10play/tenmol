---
name: forward
kind: command
category: movies-scenes-states
subcategory: playback
summary: Advances the movie by one frame.
parity: implemented
---

## Purpose
`forward` steps the movie playhead one frame forward. It is the single-step counterpart to `backward` for stepping through a defined movie frame by frame.

## Syntax
`forward()`

Takes no arguments.

## Behaviour
Moves the viewer to the next movie frame (frames are 1-based). Requires a movie to have been defined (e.g. via `mset`).

## Examples
```python
forward
```

## Related
- [backward](backward.md) - step one frame back
- [rewind](rewind.md) - jump to the first frame
- [frame](frame.md), [mset](mset.md)

## Source
`packages/engine/modules/pymol/moving.py` (`def forward`). Parity: implemented in `packages/engine-ts/src/cmd/system.ts:148`.
