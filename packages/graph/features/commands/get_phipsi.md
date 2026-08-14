---
name: get_phipsi
kind: command
category: measurement
subcategory: backbone dihedrals
summary: Return backbone phi/psi dihedral angles for CA atoms in a selection.
parity: implemented
---

## Purpose
`get_phipsi` computes the backbone phi and psi torsion angles for the residues
picked out by a CA-atom selection. Use it to extract Ramachandran-style backbone
geometry programmatically.

## Syntax
`get_phipsi(selection='(name CA)', state=-1)`

| Param | Type | Default | Meaning |
| --- | --- | --- | --- |
| `selection` | str | `'(name CA)'` | CA-atom selection identifying the residues |
| `state` | int | `-1` | 1-based state; `-1` = current state (passed as `state-1`) |

## Behaviour
The selection is preprocessed and wrapped in parentheses, then the C layer
computes phi/psi for each matched CA atom. Returns a dictionary keyed by
`(object, index)` mapping to `(phi, psi)` tuples. Residues lacking the neighbours
needed to define a torsion are omitted.

## Examples
```python
cmd.get_phipsi("myprot and name CA")
cmd.get_phipsi("chain A and resi 10-20 and name CA")
```

## Related
- [get_dihedral](get_dihedral.md), [phi_psi](phi_psi.md)

## Source
`packages/engine/modules/pymol/querying.py:880`. Parity: implemented — registered
at `packages/engine-ts/src/cmd/misc2.ts:54`.
