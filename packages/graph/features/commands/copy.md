---
name: copy
kind: command
category: objects-groups
subcategory: object duplication
summary: Creates a new object that is an identical copy of an existing object.
parity: unknown
---

## Purpose
`copy` duplicates an entire existing object under a new name, preserving all of its states and representations. Reach for it when you want an independent, editable clone of a whole object (unlike `create`, which builds a new object from an atom selection).

## Syntax
`copy(target, source, zoom=-1)`

| Param | Type | Default | Meaning |
| --- | --- | --- | --- |
| `target` | str | — | Name of the new object to create |
| `source` | str | — | Name of the existing object to copy |
| `zoom` | int | `-1` | Zoom behaviour on the new object (`-1` = use `auto_zoom` setting) |

## Behaviour
Operates at the object level (takes object names, not atom selections). Currently only molecular objects are supported. All states of `source` are copied into `target`. `zoom=-1` defers to the `auto_zoom` setting to decide whether the view re-centres on the new object.

## Examples
```python
copy prot_copy, prot
copy backup, 1ubq, zoom=0
```

## Related
- [create](../commands/create.md)
- [copy_to](../commands/copy_to.md)

## Source
`packages/engine/modules/pymol/creating.py:881` (`def copy`). No confirmed TypeScript command registration found in `packages/engine-ts/src`; parity unverified.
