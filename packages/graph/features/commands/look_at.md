---
name: look_at
kind: command
category: viewing-camera
subcategory: camera orientation
summary: Rotate an object (or the camera view) so its forward z-axis points at the center of a target object.
parity: implemented
---

## Purpose
`look_at` reorients a mobile object — or, by default, the camera — so that its
forward (z) axis faces the center of a named target object. It is a convenience for
aiming the view (or one object) directly at another without manually composing a
rotation.

## Syntax
`look_at(target_obj, mobile_obj='_Camera')`

| Param | Type | Default | Meaning |
| --- | --- | --- | --- |
| `target_obj` | str | — | the object to look at |
| `mobile_obj` | str | `'_Camera'` | the object to rotate; the special `_Camera` rotates the view |

## Behaviour
The rotation component of `mobile_obj` is modified so its z-axis points toward the
center of `target_obj`. With the default `mobile_obj='_Camera'`, it aims the camera;
passing a real object name reorients that object instead. Runs under the API lock and
delegates to `_cmd.look_at`.

## Examples
```text
look_at ligand
look_at target, probe
```

## Related
- `orient` — align the view to a selection's principal axes
- `move_on_curve` — position an object along a curve

## Source
`packages/engine/modules/pymol/editing.py:2141` (`def look_at`). Implemented in the
TS port at `packages/engine-ts/src/cmd/extras.ts:435`.
