---
name: valence
kind: command
category: editing-building
subcategory: bond editing
summary: Modifies the bond orders (valences) of existing bonds between two atom selections.
parity: implemented
---

## Purpose
`valence` changes the bond order of bonds already present between two selections — setting single/double/triple/aromatic — or, with a special order, recalculates valences from a source. Use it during molecular editing to correct or assign bond orders after building or importing a structure.

## Syntax
`valence(order, selection1=None, selection2=None, source='', target_state=0, source_state=0, reset=1, quiet=1, symop='')`

| Param | Type | Default | Meaning |
| --- | --- | --- | --- |
| `order` | str/int | — | bond order: `0/1/2/3/4` or name (`single`, `double`, `triple`, `aromatic`, …); negative routes to revalence |
| `selection1` | selection | `None` | first endpoint set; defaults to `(pk1)` |
| `selection2` | selection | `None` | second endpoint set; defaults to `(pk2)`, or `selection1` |
| `source` | selection | `''` | reference geometry for revalence |
| `target_state` | int | `0` | target state |
| `source_state` | int | `0` | source state |
| `reset` | int | `1` | reset valences before recomputing (revalence path) |
| `quiet` | int | `1` | suppress feedback |
| `symop` | str | `''` | symmetry operator (keyword-only) |

## Behaviour
A string `order` is resolved through the order shortcut/dictionary to an integer. Selection defaults mimic editing: with none given it uses `(pk1)`/`(pk2)`; if only `selection1` is given, `selection2` becomes the same selection. For `order >= 0` it calls `_cmd.bond(...)` with mode `2` (set valence on existing bonds only — it does not create new bonds). For a negative order it calls `_cmd.revalence(...)`, recomputing bond orders from `source` geometry with the `reset` flag.

## Examples
```python
valence 2, (name C), (name O)

# set the picked bond to aromatic
valence aromatic
```

## Related
- [unbond](../commands/unbond.md)
- [bond](../commands/bond.md)
- [fuse](../commands/fuse.md)
- [attach](../commands/attach.md)

## Source
`packages/engine/modules/pymol/editing.py:598`. Parity: implemented in `packages/engine-ts/src/cmd/builder.ts`.
