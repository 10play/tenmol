---
name: get_area
kind: command
category: measurement
subcategory: surface area
summary: Returns the molecular surface area of a selection, in square Angstroms.
parity: implemented
---

## Purpose
`get_area` computes the surface area of a selection. Its meaning depends on the `dot_solvent` setting: with `dot_solvent=off` (the default) it returns the solvent-excluded surface area; with `dot_solvent=on` it returns the solvent-accessible surface area. Reach for it to quantify buried/exposed surface programmatically.

## Syntax
`get_area(selection='(all)', state=1, load_b=0, quiet=1)`

| Param | Type | Default | Meaning |
| --- | --- | --- | --- |
| `selection` | str | `'(all)'` | Atom selection to measure |
| `state` | int | `1` | Coordinate state |
| `load_b` | bool | `0` | If `1`, stores each atom's surface area in its b-factor |
| `quiet` | 0/1 | `1` | If `0`, prints the area to the feedback log |

## Behaviour
The selection is pre-processed and wrapped in parentheses, then passed to `_cmd.get_area` with a zero-based `state-1`. Result granularity is governed by the `dot_density`/`dot_solvent`/`solvent_radius` settings — the same dot machinery behind the `dots` representation. With `load_b=1`, per-atom areas are written into b-factors so you can subsequently color or select by exposure. Returns a float area in Å². With `quiet=0` prints ` cmd.get_area: <n> Angstroms^2.`.

## Examples
```python
get_area polymer
get_area chain A, load_b=1
sasa = cmd.get_area("resi 45")
```

## Related
- [dot_solvent](../settings/dot_solvent.md)
- [get_extent](../commands/get_extent.md)

## Source
Upstream `packages/engine/modules/pymol/querying.py:1099`. Parity: implemented — registered as `ctx.command('get_area')` in `packages/engine-ts/src/cmd/misc.ts:160`.
