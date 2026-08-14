---
name: h_add
kind: command
category: editing-building
subcategory: hydrogens
summary: Adds hydrogen atoms onto a molecule based on current valences.
parity: implemented
---

## Purpose
`h_add` builds explicit hydrogen atoms onto a selection using each heavy atom's current valence and geometry. Reach for it after loading a PDB (which usually omits H) or after building/editing a ligand.

## Syntax
`h_add(selection='(all)', quiet=1, state=0, legacy=0)`

| Param | Type | Default | Meaning |
| --- | --- | --- | --- |
| `selection` | selection | `'(all)'` | Atoms to add hydrogens to |
| `quiet` | 0/1 | `1` | Suppress feedback when `1` |
| `state` | int | `0` | State to build in; `0` = all states |
| `legacy` | 0/1 | `0` | Use the legacy hydrogen-adding algorithm |

## Behaviour
Selection is run through `selector.process`, then delegates to `_cmd.h_add` with a zero-based state (`state-1`). Because PDB files carry no bond valences for ligands and nonstandard groups, you may need to correct ligand bond orders/conformations first, or the added hydrogens will be wrong. `legacy=1` selects the older placement algorithm.

## Examples
```python
h_add
h_add polymer, state=1
```

## Related
- [h_fill](./h_fill.md)
- [h_fix](./h_fix.md)

## Source
`packages/engine/modules/pymol/editing.py:1218`. Parity: implemented in `packages/engine-ts/src/cmd/builder.ts`.
