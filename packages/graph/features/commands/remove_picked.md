---
name: remove_picked
kind: command
category: editing-building
subcategory: interactive editing
summary: Removes the atom or bond currently picked for editing, optionally with attached hydrogens.
parity: implemented
---

## Purpose
`remove_picked` deletes the atom or bond that is currently picked in the editor (the `pk1`/`pk2` selection). It is the interactive counterpart to [remove](../commands/remove.md) and is normally bound to the DELETE key and CTRL-D during molecule building.

## Syntax
`remove_picked(hydrogens=1, quiet=1)`

| Param | Type | Default | Meaning |
| --- | --- | --- | --- |
| `hydrogens` | int | `1` | also delete hydrogens attached to the picked atom |
| `quiet` | int | `1` | suppress console feedback |

## Behaviour
Acts on the current pick rather than a named selection. By default attached hydrogens are deleted along with the picked atom; set `hydrogens=0` to leave them behind. In the TS port `remove_picked` is implemented by forwarding to `remove` on the `pk1` selection.

## Examples
```python
# after picking an atom in the editor
remove_picked
# delete the picked atom but keep its hydrogens
remove_picked 0
```

## Related
- [remove](../commands/remove.md)
- [replace](../commands/replace.md)
- [attach](../commands/attach.md)

## Source
`packages/engine/modules/pymol/editing.py:839`; signature in `docs/api-reference/commands.mdx:3213`. Parity: implemented in `packages/engine-ts/src/cmd/editing.ts:402`.
