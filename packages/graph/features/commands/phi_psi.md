---
name: phi_psi
kind: command
category: measurement
subcategory: backbone dihedrals
summary: Returns the phi and psi backbone dihedral angles for a protein selection.
parity: implemented
---

## Purpose
`phi_psi` reports the phi and psi main-chain torsion angles for each residue in a
protein selection — the coordinates behind a Ramachandran plot. Use it to inspect
backbone conformation or to feed dihedral data into analysis scripts.

## Syntax
```
phi_psi(selection='(byres pk1)', quiet=1)
```

| Param | Type | Default | Meaning |
| --- | --- | --- | --- |
| `selection` | str | `'(byres pk1)'` | protein atoms whose residues are measured (default: residues of the picked atom) |
| `quiet` | int | `1` | if 0, prints each residue's `(phi, psi)` pair |

## Behaviour
Delegates to `cmd.get_phipsi(selection)` and returns a dict keyed by
`(object, index)` mapping to a `(phi, psi)` tuple. When `quiet=0` it iterates the
sorted keys and prints each residue label with its angle pair formatted as
`( %6.1f, %6.1f )`. The default `(byres pk1)` expands the currently picked atom to
its whole residue, so picking one atom and running `phi_psi` reports that residue.

## Examples
```
phi_psi
phi_psi chain A and resi 10-20, quiet=0
```

## Related
- `get_dihedral`, `set_dihedral`, `dss` - torsion measurement and secondary structure

## Source
`packages/engine/modules/pymol/querying.py:1401`. Registered in the TS port at
`packages/engine-ts/src/cmd/measurement.ts:285`.
