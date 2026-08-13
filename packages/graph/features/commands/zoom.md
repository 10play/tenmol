---
name: zoom
kind: command
category: viewing-camera
subcategory: camera
summary: Scales and translates the view and origin to cover an atom selection.
parity: implemented
---

## Purpose
`zoom` frames a selection: it moves the camera and rotation origin and picks a
zoom level so the selected atoms fill the field of view. It is the go-to command
for "fit this to the screen" — unlike `center`, which only translates without
rescaling.

## Syntax
`zoom(selection='all', buffer=0.0, state=0, complete=0, animate=0)`

| Param | Type | Default | Meaning |
| --- | --- | --- | --- |
| `selection` | string | `'all'` | Selection-expression or name pattern to frame. |
| `buffer` | float | `0.0` | Extra padding distance (Angstroms) added around the selection. |
| `state` | int | `0` | `0`=all coordinate states, `-1`=current state only, `>0`=a specific state. |
| `complete` | int | `0` | `1` guarantees no atom center is clipped out of an orthoscopic view. |
| `animate` | float | `0` | `<0`=default duration, `0`=no animation, `>0`=animate over that many seconds. |

## Behaviour
The selection is first run through `selector.process`, then `_cmd.zoom` is called
with `state - 1` (so the public `state=0` "all states" maps to the internal
convention, matching `center`). By default PyMOL guesses an optimal zoom that
balances closeness against occasional clipping; `complete=1` instead guarantees
every atom center fits within an orthoscopic field of view. Because graphical
representations (spheres, cartoons) can extend beyond atom centers, you may still
need a `buffer` (typically ~2 A) to fully prevent clipping. A non-zero `animate`
smoothly interpolates the camera into place.

## Examples
```
zoom
zoom complete=1
zoom 142/, animate=3
zoom (chain A)
```

## Related
- [center](../commands/center.md)
- [orient](../commands/orient.md)
- [origin](../commands/origin.md)

## Source
`packages/engine/modules/pymol/viewing.py:66`. Parity: implemented — the framing
math lives in `packages/engine-ts/src/view/view.ts` (`zoomToSphere`) over the
selection bounding sphere from `packages/engine-ts/src/exec/executive.ts`, and
the `zoom` command is invoked by ported presets/utilities.
