---
name: set_name
kind: command
category: objects-groups
subcategory: object management
summary: Renames an object or a named selection.
parity: implemented
---

## Purpose
`set_name` changes the name of an existing object or named selection. Use it to tidy up auto-generated names or reorganize the object panel without recreating anything.

## Syntax
`set_name(old_name, new_name)`

| Param | Type | Default | Meaning |
| --- | --- | --- | --- |
| `old_name` | str | — | current name of the object or selection |
| `new_name` | str | — | the new name to assign |

## Behaviour
Renaming updates all references PyMOL tracks internally, so downstream commands should use the new name afterward. Choose a name not already in use; reusing an existing name conflicts. Works on both molecular/map objects and named atom selections.

## Examples
```python
set_name obj01, receptor
set_name sele, binding_site
```

## Related
- [create](create.md), [copy](copy.md) — make new named objects
- [delete](delete.md) — remove an object or selection

## Source
Upstream: `packages/engine/modules/pymol/editing.py:447` (delegates to `_cmd.set_name`). Parity: implemented at `packages/engine-ts/src/cmd/editing.ts:391` (also registered via `packages/engine-ts/src/cmd/objects.ts:237`).
