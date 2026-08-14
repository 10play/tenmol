---
name: get_symmetry
kind: command
category: symmetry
subcategory: crystal symmetry
summary: Return the unit-cell and spacegroup parameters of a molecule or map.
parity: implemented
---

## Purpose
`get_symmetry` retrieves the crystallographic cell and spacegroup for a molecular
or map object. Use it to inspect or copy symmetry (e.g. before `set_symmetry` on
another object, or before generating symmetry mates).

## Syntax
`get_symmetry(selection='(all)', state=-1, quiet=1)`

| Param | Type | Default | Meaning |
| --- | --- | --- | --- |
| `selection` | str | `'(all)'` | Object name or selection to read symmetry from |
| `state` | int | `-1` | State index (`-1` = current) |
| `quiet` | int | `1` | If `0`, prints cell edges, angles, and spacegroup |

## Behaviour
Returns a 7-element list: `[a, b, c, alpha, beta, gamma, spacegroup]` — three
cell lengths (Å), three angles (degrees), and the spacegroup name string. Returns
a falsy result if no symmetry is defined; with `quiet=0` this prints
"No symmetry defined." The selection is run through `selector.process` and
`state` is forwarded as `state - 1`.

## Examples
```python
a, b, c, al, be, ga, sg = cmd.get_symmetry("1abc")
cmd.get_symmetry("mymap", quiet=0)
```

## Related
- [set_symmetry](set_symmetry.md), [symexp](symexp.md)

## Source
`packages/engine/modules/pymol/querying.py:147`. Parity: implemented — symmetry
data is carried by `packages/engine-ts/src/model/molecule.ts`.
