---
name: fuse
kind: command
category: editing-building
subcategory: bond editing
summary: Joins two objects into one by forming a bond between a picked atom in each.
parity: implemented
---

## Purpose
`fuse` merges two objects into a single object by creating a bond between one atom from each. A copy of the object holding `selection1` is moved into an approximately reasonable bonding geometry against `selection2`, then merged into that second object. Reach for it to covalently splice fragments or ligands together interactively.

## Syntax
`fuse(selection1='(pk1)', selection2='(pk2)', mode=0, recolor=1, move=1)`

| Param | Type | Default | Meaning |
| --- | --- | --- | --- |
| `selection1` | str | `'(pk1)'` | Single-atom selection; its object is copied onto object 2 |
| `selection2` | str | `'(pk2)'` | Single-atom selection on the target object |
| `mode` | int | `0` | `3` = don't move and don't bond, just combine into one object |
| `recolor` | bool | `1` | Recolor carbon atoms to match the target |
| `move` | bool | `1` | Whether to move the copy into bonding position |

## Behaviour
Each selection must resolve to exactly one atom, and the two atoms must live in different objects. If both picked atoms are hydrogens they are eliminated (the classic replace-H-with-bond case); if both are non-hydrogens a bond is formed between them. Selections are pre-processed through `selector.process`. `mode=3` skips repositioning and bond creation, simply combining the two objects. `recolor=1` retints the incoming carbons to the destination color scheme.

## Examples
```python
fuse (pk1), (pk2)
fuse frag and elem H, target/1/CA, recolor=1
fuse objA, objB, mode=3
```

## Related
- [bond](../commands/bond.md)
- [unbond](../commands/unbond.md)
- [attach](../commands/attach.md)
- [replace](../commands/replace.md)

## Source
Upstream `packages/engine/modules/pymol/editing.py:939`. Parity: implemented — registered as `ctx.command('fuse')` in `packages/engine-ts/src/cmd/builder.ts:761`.
