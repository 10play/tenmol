---
name: extract
kind: command
category: objects-groups
subcategory: object creation
summary: Shorthand for `create` with extract enabled — moves selected atoms into a new object, removing them from the source.
parity: implemented
---

## Purpose
`extract` splits a set of atoms out of an existing object into a brand-new object, deleting them from the source. It is the move (vs. copy) counterpart of `create`, useful for pulling a ligand or chain into its own object.

## Syntax
`extract(name, selection, *arg, **kw)`

| Param | Type | Default | Meaning |
| --- | --- | --- | --- |
| `name` | str | — | Name of the new object to create |
| `selection` | selection | — | Atoms to extract into the new object |
| `*arg` | — | — | Extra positional args forwarded to `create` (e.g. `source_state`, `target_state`) |
| `**kw` | — | — | Extra keyword args forwarded to `create` |

## Behaviour
It simply sets `extract=1` and delegates to `cmd.create(name, selection, *arg, **kw)`. Because it wraps `create`, all of `create`'s optional arguments (`source_state`, `target_state`, `discrete`, `zoom`, `quiet`, `copy`) apply. The atoms end up only in the new object; the source object loses them.

## Examples
```python
extract lig, resn ATP
extract chainA, 1ubq and chain A
```

## Related
- [create](../commands/create.md)
- [copy](../commands/copy.md)

## Source
`packages/engine/modules/pymol/creating.py:1050`. Parity: implemented in `packages/engine-ts/src/cmd/extras.ts:382`.
