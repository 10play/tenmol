---
name: delete
kind: command
category: objects-groups
subcategory: object removal
summary: Removes objects and named selections (wildcards supported).
parity: implemented
---

## Purpose
`delete` removes whole objects and named selections from the session. It is the standard cleanup command; use `remove` instead when you only want to drop atoms from within an object.

## Syntax
`delete(name)`

| Param | Type | Default | Meaning |
| --- | --- | --- | --- |
| `name` | str | — | Name(s) of object(s) or selection(s); supports wildcards (`*`) |

## Behaviour
Locks the session and deletes every object or named selection matching `name`. Wildcards match by name prefix/pattern, so `delete measure*` drops all objects whose names start with `measure`, and `delete all` clears every object and selection. Deleting a named selection removes only the selection, not its atoms.

## Examples
```python
delete measure*
delete all
delete 1ubq
```

## Related
- [remove](../commands/remove.md)
- [delete_states](../commands/delete_states.md)

## Source
`packages/engine/modules/pymol/commanding.py:511` (`def delete`). Ported: `packages/engine-ts/src/exec/executive.ts:132` (`delete(pattern)`).
