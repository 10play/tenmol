---
name: h_fill
kind: command
category: editing-building
subcategory: hydrogens
summary: Removes and replaces hydrogens on the atom or bond currently picked for editing.
parity: implemented
---

## Purpose
`h_fill` removes and re-adds the hydrogens on the atom or bond picked for editing (`pk1`). Use it after changing a bond valence so the hydrogen count matches the new valence.

## Syntax
`h_fill(quiet=1)`

| Param | Type | Default | Meaning |
| --- | --- | --- | --- |
| `quiet` | 0/1 | `1` | Suppress feedback when `1` |

## Behaviour
Operates on the current edit pick rather than a selection argument. Locks the C layer and calls `_cmd.h_fill`. Typically used in the interactive editing workflow alongside `cycle_valence`: cycle a bond order, then `h_fill` to correct the attached hydrogens.

## Examples
```python
edit pk1
cycle_valence
h_fill
```

## Related
- [edit](../commands/edit.md)
- [cycle_valence](../commands/cycle_valence.md)
- [h_add](./h_add.md)

## Source
`packages/engine/modules/pymol/editing.py:1165`. Parity: implemented in `packages/engine-ts/src/cmd/builder.ts`.
