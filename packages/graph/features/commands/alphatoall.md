---
name: alphatoall
kind: command
category: editing-building
subcategory: property propagation
summary: Copies a per-residue property from each residue's CA atom out to all atoms in that residue.
parity: implemented
---

## Purpose
`alphatoall` takes any atom property held on the Cα (alpha carbon) atoms and broadcasts it to every atom of the same residue. It is commonly used after computing a per-residue value (conservation, a score, etc.) on the CA so that surface/cartoon colouring by that property looks uniform across each residue.

## Syntax
`alphatoall(selection='polymer', properties='b', operator='byca', quiet=1)`

| Param | Type | Default | Meaning |
| --- | --- | --- | --- |
| `selection` | selection | `'polymer'` | Atoms to update |
| `properties` | str | `'b'` | Space-separated list of atom properties to expand |
| `operator` | str | `'byca'` | Selection operator picking the source atoms per residue |
| `quiet` | 0/1 | `1` | Suppress the "Modified N residues" message |

## Behaviour
It first `iterate`s over `<operator> (<selection>)` (default `byca` = the CA of each residue) to stash the chosen properties into a dict keyed by `(model, segi, chain, resi)`, then `alter`s the full selection to look up and assign those stored values, falling back to the atom's own value when a residue key is missing. Multiple properties are comma-joined into a tuple expression, so `properties='b q'` expands both at once. Because it uses `alter`, a `rebuild`/`recolor` may be needed for visual updates.

## Examples
```python
alphatoall polymer, b
alphatoall chain A, b q
```

## Related
- [alter](./alter.md)
- [iterate](../commands/iterate.md)
- [spectrum](../commands/spectrum.md)

## Source
`packages/engine/modules/pymol/editing.py:3007`. Parity: implemented in `packages/engine-ts/src/cmd/extras.ts`.
