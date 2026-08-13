---
name: get_sasa_relative
kind: command
category: measurement
subcategory: solvent accessibility
summary: Compute relative per-residue solvent-accessible surface area, loading 0.0-1.0 exposure into the b-factor.
parity: implemented
---

## Purpose
`get_sasa_relative` computes each residue's solvent-accessible surface area
relative to full exposure (that residue in a tripeptide context with only its two
neighbours), giving a value from 0.0 (buried) to 1.0 (exposed). It loads the value
into the b-factor and can optionally label and color residues by exposure.

## Syntax
`get_sasa_relative(selection='all', state=1, vis=-1, var='b', quiet=1, outfile='', *, subsele='all')`

| Param | Type | Default | Meaning |
| --- | --- | --- | --- |
| `selection` | str | `'all'` | Atom selection to analyse |
| `state` | int | `1` | Object state |
| `vis` | 0/1 | `-1` | Show labels and color by exposure; `-1` = `!quiet` |
| `var` | str | `'b'` | Name of the property to assign |
| `quiet` | 0/1 | `1` | Print results to the log window |
| `outfile` | str | `''` | Write results to this file instead of the log window |
| `subsele` | str | `'all'` | Sub-selection (e.g. `sidechain`) to restrict the measured area |

## Behaviour
Forces `dot_solvent=1` for the duration, computes `get_area` with `load_b=1` per
object, then per residue rebuilds a `byres ... extend 1` tripeptide and re-measures
to get the fully-exposed reference area; the ratio is the relative SASA. Returns a
`dict` keyed by a 4-tuple `(model, segi, chain, resi)`. `subsele` lets you measure
e.g. side-chain-only exposure. `vis` defaults to the inverse of `quiet`.

## Examples
```python
cmd.fetch("1ubq", async_=0)
cmd.get_sasa_relative("polymer")

# side-chain exposure, excluding C-alpha
cmd.get_sasa_relative("polymer", subsele="sidechain")
```

## Related
- [get_area](get_area.md), [set](set.md) (`dot_solvent`, `dot_density`)

## Source
`packages/engine/modules/pymol/util.py:1064`. Parity: implemented — registered at
`packages/engine-ts/src/cmd/misc.ts:178`; note `docs/feature-parity.md:520` flags
that the tuple-keyed dict needs a bridge serialization shim.
