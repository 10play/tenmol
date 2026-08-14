---
name: get_view
kind: command
category: viewing-camera
subcategory: camera matrix
summary: Return (and optionally print) the current 18-element view matrix.
parity: implemented
---

## Purpose
`get_view` captures the current camera as an 18-element view matrix that can be
fed back to `set_view` to restore the exact orientation, zoom, clipping, and
projection. It is the primitive behind saving views in scripts and scenes.

## Syntax
`get_view(output=1, quiet=1)`

| Param | Type | Default | Meaning |
| --- | --- | --- | --- |
| `output` | int | `1` | `0` = print matrix; `1` = do not print; `2` = force print even if logging; `3` = return a formatted string instead of a list |
| `quiet` | int | `1` | Suppress feedback |

## Behaviour
Returns the 18 floats: indices 0–8 are a column-major 3×3 rotation from model to
camera space; 9–11 the rotation origin relative to the camera (camera space);
12–14 the rotation origin in model space; 15 the front clipping-plane distance;
16 the rear plane distance; 17 packs the orthoscopic flag (sign) and field of
view. The camera looks down −Z with +X left and +Y down. If a log file is open,
the matrix is not echoed to the screen unless `output=2`; `output=3` returns a
pastable formatted string rather than the list.

## Examples
```python
v = cmd.get_view()
cmd.set_view(v)
print(cmd.get_view(output=3))   # formatted block for a script
```

## Related
- [set_view](set_view.md), [get_viewport](get_viewport.md)

## Source
`packages/engine/modules/pymol/viewing.py:634`. Parity: implemented — present in
`packages/engine-ts/src/view/view.ts`.
