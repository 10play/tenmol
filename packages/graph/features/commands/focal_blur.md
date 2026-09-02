---
name: focal_blur
kind: command
category: rendering-export
subcategory: depth-of-field
summary: Produces a depth-of-field image by averaging several jittered renders, keeping the object at the origin in focus.
parity: implemented
---

## Purpose
`focal_blur` fakes a camera depth-of-field effect for presentation figures. It renders the scene several times with small jitter proportional to an aperture angle and averages the results, so geometry at the origin stays sharp while foreground/background blurs.

## Syntax
`focal_blur(aperture=2.0, samples=10, ray=0, filename='', quiet=1)`

| Param | Type | Default | Meaning |
| --- | --- | --- | --- |
| `aperture` | float | `2.0` | aperture angle in degrees; larger = more blur |
| `samples` | int | `10` | number of images averaged |
| `ray` | 0/1 | `0` | ray-trace each sample instead of using the GL image |
| `filename` | str | `''` | write result to file (default: temporary) |
| `quiet` | int | `1` | suppress feedback |

## Behaviour
The object at the origin (rotation center) is the focal plane. Increasing `samples` smooths the blur at the cost of render time; increasing `aperture` widens the blur. With `ray=1` each sample is ray-traced for higher quality. Authored by Jarl Underhaug, Jason Vertrees and Thomas Holder.

## Examples
```python
focal_blur 3.0, 50
focal_blur aperture=5, samples=100, ray=1, filename=dof.png
```

## Related
- [ray](ray.md) - ray-traced rendering
- [png](png.md) - save the current image

## Source
`packages/engine/modules/pymol/experimenting.py` (`def focal_blur`). Parity: incentive-only — `packages/engine-ts/src/cmd/extras.ts` raises `IncentiveOnlyException`, matching Open-Source PyMOL (verified against the real-PyMOL GL oracle — `packages/graph/verify/probes/command__focal_blur.json`).
