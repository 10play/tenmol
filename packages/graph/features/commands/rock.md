---
name: rock
kind: command
category: viewing-camera
subcategory: camera motion
summary: Toggles continuous Y-axis rocking of the camera.
parity: implemented
---

## Purpose
`rock` turns the gentle back-and-forth Y-axis rocking motion on or off. It is a presentation aid that gives a subtle sense of depth without a full turntable spin.

## Syntax
`rock(mode=-1)`

| Param | Type | Default | Meaning |
| --- | --- | --- | --- |
| `mode` | int | `-1` | `-1` toggles; `1` turns rocking on; `0` turns it off |

## Behaviour
Called with the default `mode=-1` it flips the current rocking state. Explicit `1`/`0` force the motion on or off. Rocking oscillates the view about the vertical (Y) axis; the amplitude and period are governed by movie/scene settings rather than arguments here. Note there is also an unrelated movie-authoring `rock` helper in `movie.py` that adds rocking key frames — this command is the live viewport toggle.

## Examples
```python
rock          # toggle
rock 1        # start rocking
rock 0        # stop
```

## Related
- [turn](../commands/turn.md)
- [spectrum](../commands/spectrum.md)

## Source
`packages/engine/modules/pymol/viewing.py:1360`; signature in `docs/api-reference/commands.mdx:3317`. Parity: implemented in `packages/engine-ts/src/cmd/movie2.ts:312`.
