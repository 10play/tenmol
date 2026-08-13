---
name: set_frame
kind: command
category: movies-scenes-states
subcategory: movie playback
summary: Internal command that sets the current global movie frame (1-based).
parity: implemented
---

## Purpose
`set_frame` is an internal navigation command that jumps the movie to a specific frame. It underlies the higher-level movie controls (`frame`, `forward`, `backward`, `ending`, `middle`) and is generally reached through those rather than called directly.

## Syntax
`set_frame(frame=1, mode=0)`

| Param | Type | Default | Meaning |
| --- | --- | --- | --- |
| `frame` | int | `1` | target frame number (1-based) |
| `mode` | int | `0` | frame-setting mode (absolute / relative navigation) |

## Behaviour
The `frame` argument is 1-based at the API and decremented to 0-based internally. `mode` selects the navigation semantics — the related convenience commands invoke `set_frame` with fixed modes (e.g. `ending` uses mode 6, frame 0). Its docstring is simply marked `internal`; prefer `frame` for ordinary use.

## Examples
```python
set_frame 10
```

## Related
- [frame](frame.md) — public frame-navigation command
- [ending](ending.md), [middle](middle.md) — jump to movie extremes

## Source
Upstream: `packages/engine/modules/pymol/moving.py:898` (marked `internal`). Parity: implemented at `packages/engine-ts/src/cmd/xform.ts:208`.
