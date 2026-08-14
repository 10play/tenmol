---
name: rotate
kind: command
category: editing-building
subcategory: coordinate transform
summary: Rotates atom coordinates in a selection about an axis, or modifies an object/state matrix.
parity: implemented
---

## Purpose
`rotate` turns the coordinates of atoms in a selection about a named or vector axis. Alternatively, when an object is named it modifies that object's (or state's) transformation matrix instead — a mode intended for animation. Reach for it to reorient a fragment, or to spin a whole object in a movie.

## Syntax
`rotate(axis='x', angle=0.0, selection='all', state=-1, camera=1, object=None, origin=None, object_mode=0)`

| Param | Type | Default | Meaning |
| --- | --- | --- | --- |
| `axis` | string or float-vector | `'x'` | `x`/`y`/`z` or a `[x,y,z]` vector to rotate about |
| `angle` | float | `0.0` | degrees of rotation |
| `selection` | string | `'all'` | atoms whose coordinates are modified (ignored if `object` set) |
| `state` | int | `-1` | `>0` one state; `0` all states; `-1` current state |
| `camera` | int | `1` | interpret `axis` in camera coordinates? |
| `object` | string | `None` | object name — rotate its matrix instead of atoms |
| `origin` | float-vector | `None` | origin of rotation |
| `object_mode` | int | `0` | matrix-application mode when rotating an object matrix |

## Behaviour
String axes `x`/`y`/`z` are expanded to unit vectors; any other value is parsed as a list via `safe_list_eval`. With `object=None` the atomic coordinates are modified directly, so all touched representation geometries must be rebuilt. When `object` is set, the `selection` field is ignored and the object's matrix is altered instead — the docstring notes this path is only intended for animations and is not yet fully supported. `camera=1` (default) interprets the axis in screen/camera space rather than model space.

## Examples
```python
rotate x, 45, pept
rotate [1,1,1], 10, chain A
rotate y, 90, object=myobj
```

## Related
- [translate](../commands/translate.md)
- [turn](../commands/turn.md)
- [reset](../commands/reset.md)

## Source
`packages/engine/modules/pymol/editing.py:2002`; signature in `docs/api-reference/commands.mdx:3325`. Parity: implemented in `packages/engine-ts/src/cmd/transforms.ts:177`.
