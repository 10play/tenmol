---
name: curve_new
kind: command
category: objects-groups
subcategory: curve object
summary: Creates a new curve object (currently only Bezier curves).
parity: implemented
---

## Purpose
`curve_new` creates a new curve object, used for defining spline paths (e.g. Bezier curves for camera motion or geometric guides). Reach for it when you need a manipulable curve primitive in the scene.

## Syntax
`curve_new(name='', curve_type='bezier')`

| Param | Type | Default | Meaning |
| --- | --- | --- | --- |
| `name` | str | `''` | Name of the curve object to create (auto-named `Curve*` if empty) |
| `curve_type` | str | `'bezier'` | Type of curve; currently only `'bezier'` is supported |

## Behaviour
If `name` is empty an unused `Curve` name is generated via `get_unused_name`. It then locks the session and creates the curve of the given type in the C layer. Only `bezier` is currently valid for `curve_type`.

## Examples
```python
curve_new
curve_new path1
curve_new spline, curve_type=bezier
```

## Related
- [create](../commands/create.md)

## Source
`packages/engine/modules/pymol/creating.py:1210` (`def curve_new`). Ported: `packages/engine-ts/src/cmd/movie2.ts:344` (`ctx.command('curve_new', ...)`).
