---
name: set_geometry
kind: command
category: editing-building
subcategory: valence geometry
summary: Overrides PyMOL's assumed hybridization geometry and valence for atoms in a selection.
parity: implemented
---

## Purpose
`set_geometry` changes PyMOL's assumptions about the proper valence and coordination geometry of atoms, which affects how bonds are added (`attach`, `fuse`, `bond`) and how open valences are filled during editing. Use it when the automatic perception gets an atom's hybridization wrong.

## Syntax
`set_geometry(selection, geometry, valence)`

| Param | Type | Default | Meaning |
| --- | --- | --- | --- |
| `selection` | str | — | atoms to modify |
| `geometry` | int | — | geometry/hybridization code (e.g. linear, planar, tetrahedral) |
| `valence` | int | — | expected number of connections |

## Behaviour
`geometry` is an integer coordination code and `valence` the target connection count; together they tell the builder how many bonds an atom should have and their spatial arrangement. The upstream docstring notes this is "immature functionality" — behaviour is defined by the code rather than a stable spec, and effects are most visible when subsequently attaching or fusing fragments.

## Examples
```python
set_geometry (name C1), 3, 3
attach C, 3, 3
```

## Related
- [attach](attach.md), [fuse](fuse.md), [bond](bond.md), [unbond](unbond.md)
- [remove](remove.md)

## Source
Upstream: `packages/engine/modules/pymol/editing.py:473` (delegates to `_cmd.set_geometry`). Parity: implemented at `packages/engine-ts/src/cmd/builder.ts:697`.
