---
name: edit
kind: command
category: editing-building
subcategory: atom/bond picking
summary: Picks one or more atoms (or a bond) for editing, populating the (pk1..pk4) picked selections.
parity: implemented
---

## Purpose
`edit` sets the editor's active pick(s) from selections rather than the mouse, establishing the `(pk1)`–`(pk4)` handles that build/torsion/replace operations act on. With one selection it picks an atom; with two it picks the bond between them.

## Syntax
`edit(selection1='', selection2='none', selection3='none', selection4='none', pkresi=0, pkbond=1, quiet=1)`

| Param | Type | Default | Meaning |
| --- | --- | --- | --- |
| `selection1` | selection | `''` | First atom to pick (→ pk1) |
| `selection2` | selection | `'none'` | Second atom; with pkbond, picks the bond between 1 and 2 |
| `selection3` | selection | `'none'` | Third pick (→ pk3) |
| `selection4` | selection | `'none'` | Fourth pick (→ pk4) |
| `pkresi` | 0/1 | `0` | Pick at residue granularity |
| `pkbond` | 0/1 | `1` | If two selections given, pick the bond between them |
| `quiet` | 0/1 | `1` | Suppress feedback |

## Behaviour
All four selections are run through `selector.process` before `_cmd.edit`. With only `selection1`, a single atom is picked. With `selection1` and `selection2` and `pkbond=1`, the connecting bond is picked (set `pkbond=0` to keep them as two atom picks). The resulting picks drive downstream editor verbs like `torsion`, `cycle_valence`, and `remove_picked`; clear them with `unpick`.

## Examples
```python
edit 12/CA                 # pick one atom
edit 12/CA, 12/CB          # pick the CA-CB bond
edit resi 10, resi 11, pkbond=0
```

## Related
- [unpick](../commands/unpick.md)
- [remove_picked](../commands/remove_picked.md)
- [cycle_valence](../commands/cycle_valence.md)
- [torsion](../commands/torsion.md)

## Source
`packages/engine/modules/pymol/editing.py:1080`. Parity: implemented in `packages/engine-ts/src/cmd/editing.ts`.
