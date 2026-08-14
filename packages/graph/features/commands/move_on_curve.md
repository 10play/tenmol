---
name: move_on_curve
kind: command
category: movies-scenes-states
subcategory: camera curves
summary: Positions an object along a named curve at a parametric point t.
parity: implemented
---

## Purpose
`move_on_curve` places a mobile object at parameter `t` along a previously
defined curve object. It is a building block for camera/object fly-throughs
where motion follows a smooth spline rather than linear keyframe interpolation.

## Syntax
```
move_on_curve(mobile_obj, curve_obj, t)
```

| Param | Type | Default | Meaning |
| --- | --- | --- | --- |
| `mobile_obj` | str | | the object to move |
| `curve_obj` | str | | the curve to move the object along |
| `t` | float | | parametric position along the curve |

## Behaviour
Locks the C layer and calls `_cmd.move_on_curve(mobile_obj, curve_obj, t)`,
evaluating the curve at `t` and setting the mobile object's transform to that
point. `t` is a keyword-or-positional; `_self` is keyword-only. The curve object
must already exist (see `curve_new`).

## Examples
```
move_on_curve myprotein, camcurve, 0.5
```

## Related
- [mmatrix](mmatrix.md), [mview](mview.md) - other movie camera mechanisms
- `curve_new` - create the curve object

## Source
`packages/engine/modules/pymol/editing.py:2167`. Registered in the TS port at
`packages/engine-ts/src/cmd/movie2.ts:353`.
