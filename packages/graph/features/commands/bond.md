---
name: bond
kind: command
category: editing-building
subcategory: bonds
summary: Creates a new bond between two single-atom selections in the same object.
parity: implemented
---

## Purpose
`bond` creates a new chemical bond between two atoms, each identified by a
selection that should resolve to exactly one atom. Reach for it when building or
repairing connectivity by hand, typically after picking atoms into `pk1`/`pk2`.

## Syntax
`bond(atom1='pk1', atom2='pk2', order=1, *, quiet=1, symop='')`

| Param | Type | Default | Meaning |
| --- | --- | --- | --- |
| `atom1` | str | `'pk1'` | Atom selection of the first atom. |
| `atom2` | str | `'pk2'` | Atom selection of the second atom. |
| `order` | int | `1` | Bond order. |
| `quiet` | int | `1` | Suppress feedback when set. |
| `symop` | str | `''` | Symmetry operation code for the second atom (e.g. `"1_555"`). |

## Behaviour
Both selections are run through `selector.process` and must resolve within the
**same object** — you cannot bond atoms across objects. With no arguments it
bonds the currently picked atoms `pk1` and `pk2`, matching the interactive
editing workflow. `order` sets single/double/triple/etc. bond order. `symop`
lets the second atom be specified in a symmetry-related copy for building across
crystallographic contacts.

## Examples
```
bond
bond name C, name N, 1
bond /prot//A/10/C, /prot//A/11/N
```

## Related
- [unbond](../commands/unbond.md)
- [fuse](../commands/fuse.md)
- [attach](../commands/attach.md)

## Source
`packages/engine/modules/pymol/editing.py:696`. Ported in
`packages/engine-ts/src/cmd/editing.ts` (registered at editor `bond`).
