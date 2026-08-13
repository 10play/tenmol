---
name: split_chains
kind: command
category: objects-groups
subcategory: object splitting
summary: Creates a single new object for each chain found in a selection.
parity: unknown
---

## Purpose
`split_chains` breaks a multi-chain structure apart, producing one object per
chain. It is handy for coloring, aligning, or manipulating chains independently
after loading a complex.

## Syntax
`split_chains(selection='(all)', prefix=None, group=None, quiet=1)`

| Param | Type | Default | Meaning |
| --- | --- | --- | --- |
| `selection` | string | `'(all)'` | Atoms whose chains are split out. |
| `prefix` | string | `None` | Naming prefix; if given, objects are named `<prefix>NNNN`, else `<model>_<chain>`. |
| `group` | string | `None` | If given, the new objects are added to this group. |
| `quiet` | int | `1` | Suppress feedback when set. |

## Behaviour
For every source object in the selection, the command enumerates its chains and
issues a `create` per chain (`(selection) and model <m> and chain "<c>"`). Without
a `prefix`, new objects are named `<model>_<chain>`; with a `prefix`, they are
sequentially numbered `<prefix>0001`, `<prefix>0002`, ... The original objects are
disabled (hidden) after splitting. When `group` is supplied, all created names
are added to that group.

## Examples
```
split_chains 1abc
split_chains complex, prefix=chain, group=chains
```

## Related
- [split_states](../commands/split_states.md)
- [create](../commands/create.md)
- [group](../commands/group.md)

## Source
`packages/engine/modules/pymol/editing.py:2979`. Parity: unknown — no dedicated
`split_chains` command was found in `packages/engine-ts/src`.
