---
name: get_extent
kind: command
category: measurement
subcategory: bounding box
summary: Returns the min and max XYZ coordinates (bounding box) of a selection.
parity: implemented
---

## Purpose
`get_extent` returns the axis-aligned bounding box of a selection as `[[min-X, min-Y, min-Z], [max-X, max-Y, max-Z]]`. Reach for it to size a viewport, place a map/box, or compute a selection's spatial extent.

## Syntax
`get_extent(selection='(all)', state=0, quiet=1)`

| Param | Type | Default | Meaning |
| --- | --- | --- | --- |
| `selection` | selection | `'(all)'` | Atoms to bound |
| `state` | int | `0` | Coordinate state; `0` = all states |
| `quiet` | 0/1 | `1` | If `0`, prints the min/max rows |

## Behaviour
The selection is processed via `selector.process`, then `_cmd.get_min_max` is called with a zero-based `state-1`. The default `state=0` bounds across all states. Returns a two-element list of XYZ triples. With `quiet=0` it prints `cmd.extent: min: [...]` and `cmd.extent: max: [...]`.

## Examples
```python
get_extent chain A
(mn, mx) = cmd.get_extent("polymer", state=1)
```

## Related
- [get_position](../commands/get_position.md)
- [zoom](../commands/zoom.md)

## Source
`packages/engine/modules/pymol/querying.py:1378`. Parity: implemented in `packages/engine-ts/src/cmd/measurement.ts`; return type mapped to `[Vec3, Vec3]` in the gen-api override table.
