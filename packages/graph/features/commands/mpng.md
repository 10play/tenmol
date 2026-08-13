---
name: mpng
kind: command
category: rendering-export
subcategory: movie export
summary: Writes movie frames to a series of numbered PNG files.
parity: partial
---

## Purpose
`mpng` renders each movie frame to disk as a numbered PNG sequence (prefix +
number + `.png`), the standard first step in producing a movie file for external
encoding. Frames may be ray-traced depending on settings.

## Syntax
```
mpng(prefix, first=0, last=0, preserve=0, modal=0, mode=-1, quiet=1, width=0, height=0)
```

| Param | Type | Default | Meaning |
| --- | --- | --- | --- |
| `prefix` | str | | filename prefix; outputs are numbered and end in `.png` |
| `first` | int | `0` | starting frame (0 = first frame) |
| `last` | int | `0` | last frame (0 = last frame) |
| `preserve` | int | `0` | only write files that do not already exist |
| `modal` | int | `0` | render frames with a modal draw loop |
| `mode` | int | `-1` | 2=ray, 1=draw, 0=normal; -1 checks `ray_trace_frames`/`draw_frames` |
| `quiet` | int | `1` | suppress feedback |
| `width` | int | `0` | width in pixels (0 = current viewport) |
| `height` | int | `0` | height in pixels (0 = current viewport) |

## Behaviour
`first`/`last` define an inclusive frame interval (internally decremented to
0-based); zeros mean the whole movie. If `mode` is `2` (ray) or `-1` with
`ray_trace_frames` set, rendering runs directly; otherwise it runs inside an
OpenGL context. With `preserve=1` only missing frames are written, enabling
distributed/resumable rendering. Avoid `cache_frames` on long movies to prevent
running out of memory. Ray tracing every frame can take hours.

## Examples
```
mpng /tmp/mymovie_
mpng frame_, first=1, last=60, mode=2
mpng frame_, preserve=1, width=1920, height=1080
```

## Related
- [png](png.md), `save` - single-image / general export
- [mplay](mplay.md), [mset](mset.md) - movie playback and setup

## Source
`packages/engine/modules/pymol/moving.py:366`. Registered in the TS port at
`packages/engine-ts/src/cmd/movie2.ts:417` as a no-op (browser port performs no
file IO).
