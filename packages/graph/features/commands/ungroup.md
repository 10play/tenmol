---
name: ungroup
kind: command
category: objects-groups
subcategory: group membership
summary: Removes an object from a group, returning it to the top level.
parity: implemented
---

## Purpose
`ungroup` detaches one or more member objects from their containing group object, promoting them back to the top level of the object list. It is the inverse of adding members with `group`.

## Syntax
`ungroup(members, quiet=1)`

| Param | Type | Default | Meaning |
| --- | --- | --- | --- |
| `members` | str | — | name (or name pattern) of the object(s) to remove from their group |
| `quiet` | int | `1` | suppress feedback |

## Behaviour
It calls `_cmd.group(_COb, "", members, 7, quiet)` — the shared group entry point with an empty group name and action code `7` (ungroup). The named members are removed from whatever group they belong to; the group object itself is left in place (empty groups are not auto-deleted here). Members keep all their representations and settings.

## Examples
```python
# release one object from its group
ungroup helix_a

# release several
ungroup chainA chainB
```

## Related
- [group](../commands/group.md)

## Source
`packages/engine/modules/pymol/creating.py:155`. Parity: implemented in `packages/engine-ts/src/cmd/editing.ts`.
