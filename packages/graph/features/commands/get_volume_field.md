---
name: get_volume_field
kind: command
category: maps-volumes
subcategory: volume data access
summary: API-only accessor returning the raw grid data of a map or volume object.
parity: implemented
---

## Purpose
`get_volume_field` returns the raw scalar field (a NumPy array) backing a map or
volume object, for programmatic analysis of density values. It is API-only and
explicitly marked experimental and subject to change.

## Syntax
`get_volume_field(objName, state=1, copy=1)`

| Param | Type | Default | Meaning |
| --- | --- | --- | --- |
| `objName` | str | — | Map/volume object name |
| `state` | int | `1` | State index (1-based) |
| `copy` | 0/1 | `1` | `1` copies the data; `0` returns a wrapper of internal memory |

## Behaviour
Returns the grid as a NumPy array. `state` is forwarded as `state - 1`. With
`copy=0` the array wraps PyMOL's internal buffer directly — fast but dangerous:
if that memory is freed or reallocated the wrapper becomes invalid, so only use
`copy=0` when you know the object outlives the array. Header warns
"EXPERIMENTAL AND SUBJECT TO CHANGE - DO NOT USE".

## Examples
```python
import numpy as np
data = cmd.get_volume_field("mymap")
print(data.shape, np.mean(data))
```

## Related
- [get_volume_histogram](get_volume_histogram.md), [volume](volume.md), [get_symmetry](get_symmetry.md)

## Source
`packages/engine/modules/pymol/querying.py:40`. Parity: implemented — present in
`packages/engine-ts/src/cmd/maps.ts`.
