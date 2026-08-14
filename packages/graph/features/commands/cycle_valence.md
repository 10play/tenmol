---
name: cycle_valence
kind: command
category: editing-building
subcategory: bond order
summary: Cycles the bond order (single/double/triple/aromatic) of the currently picked bond.
parity: implemented
---

## Purpose
`cycle_valence` cycles the valence (bond order) of the currently picked bond, rotating through single, double, triple, and aromatic. It is a builder/editing action, usually driven from a keyboard shortcut, for adjusting bond orders while constructing or fixing chemistry.

## Syntax
`cycle_valence(h_fill=1, quiet=1)`

| Param | Type | Default | Meaning |
| --- | --- | --- | --- |
| `h_fill` | int (0/1) | `1` | Add/remove hydrogens to satisfy valence after the change |
| `quiet` | int | `1` | Suppress status output when `1` |

## Behaviour
Acts on the currently picked bond (`pk1`/`pk2`). After cycling the bond order, if `h_fill` is true it calls `h_fill` to add or remove hydrogens so valence requirements stay satisfied. In the desktop GUI this is normally bound to the DELETE key and CTRL-W. Requires a picked bond; with none picked it has nothing to act on.

## Examples
```python
# pick a bond first, then:
cycle_valence
cycle_valence h_fill=0
```

## Related
- [remove_picked](../commands/remove_picked.md)
- [attach](../commands/attach.md)
- [replace](../commands/replace.md)
- [fuse](../commands/fuse.md)

## Source
`packages/engine/modules/pymol/editing.py:876` (`def cycle_valence`). Ported: `packages/engine-ts/src/cmd/builder.ts:655` (`ctx.command('cycle_valence', ...)`).
