---
name: set_dihedral
kind: command
category: editing-building
subcategory: geometry editing
summary: Sets the dihedral angle defined by four bonded, acyclic atoms by rotating about the central bond.
parity: implemented
---

## Purpose
`set_dihedral` changes the dihedral (torsion) angle formed by four bonded atoms, rotating the downstream portion of the molecule about the atom2–atom3 bond. Use it to set a specific backbone or side-chain torsion during model building.

## Syntax
`set_dihedral(atom1, atom2, atom3, atom4, angle, state=1, quiet=1)`

| Param | Type | Default | Meaning |
| --- | --- | --- | --- |
| `atom1` | str | — | first atom selection (one atom) |
| `atom2` | str | — | second atom (central bond start) |
| `atom3` | str | — | third atom (central bond end) |
| `atom4` | str | — | fourth atom |
| `angle` | float | — | target dihedral angle in degrees |
| `state` | int | `1` | object state to modify |
| `quiet` | int | `1` | suppress console feedback |

## Behaviour
The four atoms must be bonded in sequence and **acyclic** — you cannot set a dihedral across a ring bond. Because it uses the molecular editing machinery, any numbered `pk` picked-atom selections are redefined by the operation. Each selection should resolve to a single atom. The rotation moves the fragment on atom4's side of the atom2–atom3 bond.

## Examples
```python
set_dihedral (resi 10 and name N), (resi 10 and name CA), \
             (resi 10 and name C), (resi 11 and name N), 180
```

## Related
- [get_dihedral](get_dihedral.md) — read the current dihedral
- [torsion](torsion.md), [edit](edit.md) — interactive torsion editing

## Source
Upstream: `packages/engine/modules/pymol/editing.py:2564` (delegates to `_cmd.set_dihe`). Parity: implemented at `packages/engine-ts/src/cmd/editing.ts:540`.
