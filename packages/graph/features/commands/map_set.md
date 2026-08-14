---
name: map_set
kind: command
category: maps-volumes
subcategory: map arithmetic
summary: Performs elementwise operations on and between map objects (min, max, sum, average, difference, copy, unique).
parity: partial
---

## Purpose
`map_set` combines one or more source maps into a target map using a named operator, or copies a map. Reach for it to build a difference map, average several maps, or take a per-voxel minimum/maximum. Experimental.

## Syntax
`map_set(name, operator, operands='', target_state=0, source_state=0, zoom=0, quiet=1)`

| Param | Type | Default | Meaning |
| --- | --- | --- | --- |
| `name` | str | — | Target map object name (created/overwritten) |
| `operator` | str | — | One of `minimum`, `maximum`, `sum`, `average`, `difference`, `copy`, `unique` |
| `operands` | str | `''` | Space-separated source map names |
| `target_state` | int | `0` | Target state; `-1` = current state |
| `source_state` | int | `0` | Source state; `0` = all states |
| `zoom` | int | `0` | Zoom to the result when set |
| `quiet` | int | `1` | Suppress feedback when set |

## Behaviour
The operator string is validated against the internal `map_op_dict` (`minimum`→0, `maximum`→1, `sum`→2, `average`→3, `difference`→4, `copy`→5, `unique`→6) via a `Shortcut`, so abbreviations that resolve uniquely are accepted; an unknown operator raises. States are passed to the engine as `state-1`. `source_state=0` means all states and `target_state=-1` means the current state.

## Examples
```python
map_set my_sum, sum, map1 map2 map3
map_set my_avg, average, map1 map2 map3
map_set diff, difference, fo fc
```

## Related
- [map_new](./map_new.md)
- [map_generate](./map_generate.md)

## Source
`packages/engine/modules/pymol/editing.py:2615`. Parity: registered as a no-op stub (needs a full map object model) in `packages/engine-ts/src/cmd/extras.ts:535`.
