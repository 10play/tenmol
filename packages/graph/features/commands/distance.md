---
name: distance
kind: command
category: measurement
subcategory: distance measurement
summary: Creates a named distance-measurement object between two atom selections, with several interaction modes.
parity: implemented
---

## Purpose
`distance` measures atomic distances between two selections and stores them as a dashed measurement object. Beyond raw interatomic distances it can filter to bonds, polar contacts (H-bonds), centroids, and pi-stacking/cation interactions via `mode`. It is the scripting counterpart of the interactive distance wizard.

## Syntax
`distance(name=None, selection1='(pk1)', selection2='(pk2)', cutoff=None, mode=None, zoom=0, width=None, length=None, gap=None, label=1, quiet=1, reset=0, state=0, state1=-3, state2=-3)`

| Param | Type | Default | Meaning |
| --- | --- | --- | --- |
| `name` | str | `None` | Name of the distance object (auto-generated if omitted) |
| `selection1` | selection | `'(pk1)'` | First atom selection |
| `selection2` | selection | `'(pk2)'` | Second atom selection |
| `cutoff` | float | `None` | Longest distance to show |
| `mode` | int | `None` | Measurement mode (see below; defaults to 0) |
| `zoom` | 0/1 | `0` | Zoom to the object after creation |
| `width` | float | `None` | Dash width override |
| `length` | float | `None` | Dash length override |
| `gap` | float | `None` | Dash gap override |
| `label` | 0/1 | `1` | Show numeric distance labels |
| `quiet` | 0/1 | `1` | Suppress feedback |
| `reset` | 0/1 | `0` | Reset/replace an existing object |
| `state` | int | `0` | Object state; 0 = all states |
| `state1`, `state2` | int | `-3` | Overrule `state` per selection to measure between different states |

## Behaviour
Modes: `0` all interatomic distances; `1` only bond distances; `2` only polar-contact distances; `3` like 0 but honours the `distance_exclusion` setting; `4` centroid-to-centroid (no dynamic_measures; new in 1.8.2); `5` pi-pi and pi-cation; `6` pi-pi; `7` pi-cation; `8` like mode 3 but `cutoff` is the ratio of distance to summed VDW radii. There is an argument-shift heuristic: if `name` looks like a selection (starts with `(`, or contains a space or `/`), the positional args are shifted so `distance 14/CA, 29/CA` works without a name. Undefined `(pk1)`/`(pk2)` picks error out.

## Examples
```python
distance mydist, 14/CA, 29/CA
distance hbonds, all, all, 3.2, mode=2
distance 14/CA, 29/CA          # unnamed; name inferred as a selection
```

## Related
- [dist](./dist.md)
- [dihedral](./dihedral.md)
- [angle](../commands/angle.md)
- [get_distance](../commands/get_distance.md)

## Source
`packages/engine/modules/pymol/querying.py:380`. Parity: implemented in `packages/engine-ts/src/cmd/dashes.ts`.
