---
name: group
kind: command
category: objects-groups
subcategory: object hierarchy
summary: Creates or updates a group object that containerizes other objects into a hierarchy.
parity: implemented
---

## Purpose
`group` creates or updates a group object — a container that organizes objects into a collapsible hierarchy in the object panel. Use it to tidy many related objects under one name and to operate on them collectively.

## Syntax
`group(name, members='', action='auto', quiet=1)`

| Param | Type | Default | Meaning |
| --- | --- | --- | --- |
| `name` | string | — | Name of the group (`all` is remapped to `*`) |
| `members` | string | `''` | Space-separated list of objects to include |
| `action` | string | `'auto'` | One of `add, remove, open, close, toggle, auto, empty, purge, excise, ungroup, raise` |
| `quiet` | 0/1 | `1` | Suppress feedback when `1` |

## Behaviour
Actions: `add` adds members; `remove`/`empty` ungroup members; `purge` removes and deletes members; `excise` deletes the group and its members; `open`/`close`/`toggle` control panel expansion; `raise` lifts a group and members to top level. `auto` (the default) adds when `members` is given, else toggles an existing group, else adds. `action='ungroup'` is deprecated — use the `ungroup` command instead (it prints a warning). A group used as a selection includes all atoms of all members, and can generally be passed as a command argument. Setting `group_auto_mode` affects auto-grouping by name prefix.

## Examples
```python
group kinases, 1oky 1pkg 1t46 1uwh 1z5m
group kinases, open
group kinases, close
```

## Related
- [ungroup](../commands/ungroup.md)
- [order](../commands/order.md)

## Source
`packages/engine/modules/pymol/creating.py:84`. Parity: implemented in `packages/engine-ts/src/cmd/editing.ts`.
