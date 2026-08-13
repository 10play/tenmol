---
name: set_view
kind: command
category: viewing-camera
subcategory: camera
summary: Restores the full camera state (rotation, position, origin, clipping planes, orthoscopic flag) from an 18-float view sequence.
parity: implemented
---

## Purpose
`set_view` applies a previously captured camera specification to the current scene. Paired with `get_view`, it lets you save and precisely reproduce a viewpoint across sessions or scripts. The view is an 18-element sequence: a 3×3 rotation matrix, camera position, rotation origin, front/back clipping and the orthoscopic flag.

## Syntax
`set_view(view, animate=0, quiet=1, hand=1)`

| Param | Type | Default | Meaning |
| --- | --- | --- | --- |
| `view` | str or sequence | — | 18 floats describing the camera state |
| `animate` | float | `0` | Seconds to animate the transition; 0 = jump |
| `quiet` | int | `1` | Suppress feedback |
| `hand` | int | `1` | Handedness handling during interpolation |

## Behaviour
A string `view` is parsed via `safe_list_eval`; the sequence must contain exactly 18 floats or a `CmdException` is raised. Internally the 18 values are expanded to a full 4×4 homogeneous matrix (rotation in the upper-left, identity translation row) plus the position, origin and clip/ortho values before dispatch. `animate > 0` produces a smooth camera fly rather than an instant cut.

## Examples
```python
set_view (\
    0.999876618,   -0.000452542,   -0.015699286,\
    0.000446742,    0.999999821,   -0.000372844,\
    0.015699454,    0.000365782,    0.999876678,\
    0.000000000,    0.000000000, -150.258514404,\
   11.842411041,   20.648729324,    8.775371552,\
  118.464958191,  182.052062988,    0.000000000 )
```

## Related
- [get_view](./get_view.md)
- [view](./view.md)

## Source
`packages/engine/modules/pymol/viewing.py:734`; signature in `docs/api-reference/commands.mdx:3740`. Parity: implemented in `packages/engine-ts/src/view/view.ts`.
