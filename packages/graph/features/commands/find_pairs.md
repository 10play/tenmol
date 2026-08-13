---
name: find_pairs
kind: command
category: querying
subcategory: proximity operator
summary: API-only function returning a list of (model,index) atom pairs within a distance cutoff, optionally restricted to hydrogen-bond-like geometry.
parity: implemented
---

## Purpose
`find_pairs` is an API-only query that returns pairs of atoms from two selections that lie within a distance cutoff. With `mode=1` it applies a coarse hydrogen-bonding geometry test. Use it when you need the actual pair list programmatically rather than a drawn distance measure.

## Syntax
`find_pairs(selection1, selection2, state1=1, state2=1, cutoff=3.5, mode=0, angle=45)`

| Param | Type | Default | Meaning |
| --- | --- | --- | --- |
| `selection1` | str | | first atom selection |
| `selection2` | str | | second atom selection |
| `state1` | int | `1` | state index for selection1 (positive only) |
| `state2` | int | `1` | state index for selection2 (positive only) |
| `cutoff` | float | `3.5` | distance cutoff |
| `mode` | int | `0` | if 1, do coarse hydrogen-bonding assessment |
| `angle` | float | `45` | H-bond angle cutoff, used only when mode=1 |

## Behaviour
Returns a Python list of `((model1, index1), (model2, index2))` tuples. WARNING: the hydrogen-bonding check only inspects atom orientation, not atom type, so it would report an "H-bond" between two carbons; supply chemically appropriate selections. Although it resembles `distance`, it uses a completely different routine and the `mode` argument has different meanings than in `distance`. Only positive state indices are accepted.

## Examples
```python
pairs = cmd.find_pairs("polymer", "polymer", cutoff=3.5, mode=1, angle=45)
donors = cmd.find_pairs("donor", "acceptor", mode=1)
```

## Related
- [distance](distance.md) - draws a measured distance
- [within](within.md) - proximity selection operator

## Source
`packages/engine/modules/pymol/querying.py` (`def find_pairs`). Parity: implemented in `packages/engine-ts/src/cmd/misc.ts:216`.
