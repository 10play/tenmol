---
name: get_volume_histogram
kind: command
category: maps-volumes
subcategory: volume data access
summary: API-only accessor returning min/max/mean/stdev plus a histogram of a map or volume.
parity: implemented
---

## Purpose
`get_volume_histogram` computes summary statistics and a value histogram over the
scalar field of a map or volume object. Use it to choose contour levels or drive
a volume-ramp editor (it feeds the histogram widget in volume dialogs).

## Syntax
`get_volume_histogram(objName, bins=64, range=None)`

| Param | Type | Default | Meaning |
| --- | --- | --- | --- |
| `objName` | str | — | Map/volume object name |
| `bins` | int | `64` | Number of histogram bins |
| `range` | tuple | `None` | `(min, max)` value range; `None` = auto (`(0., 0.)`) |

## Behaviour
Returns a list of length `bins + 4`: the first four elements are `min`, `max`,
`mean`, `stdev`, followed by the `bins` histogram counts. A `None` range is
passed to the engine as `(0., 0.)`, which requests auto-ranging over the data.
API-only.

## Examples
```python
stats = cmd.get_volume_histogram("mymap", bins=128)
vmin, vmax, mean, stdev = stats[:4]
counts = stats[4:]
```

## Related
- [get_volume_field](get_volume_field.md), [volume](volume.md), [volume_ramp_new](volume_ramp_new.md)

## Source
`packages/engine/modules/pymol/querying.py:62`. Parity: implemented — present in
`packages/engine-ts/src/cmd/maps.ts`.
