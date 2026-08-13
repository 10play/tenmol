---
name: rewind
kind: command
category: movies-scenes-states
subcategory: movie playback
summary: Jumps the movie to its first frame.
parity: implemented
---

## Purpose
`rewind` moves the movie playhead to the beginning (frame 1). Reach for it to restart playback from the start, typically wired to the "|<" transport button.

## Syntax
`rewind()` — takes no arguments.

## Behaviour
Internally calls the frame-setting primitive with mode 4 and index 0, positioning the movie at its first frame without starting playback. It is the counterpart to [ending](../commands/ending.md) (jump to last frame) and complements [forward](../commands/forward.md)/[backward](../commands/backward.md) single-step navigation.

## Examples
```python
rewind
```

## Related
- [ending](../commands/ending.md)
- [forward](../commands/forward.md)
- [backward](../commands/backward.md)
- [mplay](../commands/mplay.md)

## Source
`packages/engine/modules/pymol/moving.py:874`; signature in `docs/api-reference/commands.mdx:3277`. Parity: implemented in `packages/engine-ts/src/cmd/system.ts:160`.
