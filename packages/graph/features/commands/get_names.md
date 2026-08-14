---
name: get_names
kind: command
category: objects-groups
subcategory: name listing
summary: Returns a list of object and/or selection names filtered by a type mode.
parity: implemented
---

## Purpose
`get_names` returns a list of names for objects and/or selections currently loaded, filtered by a type category and optionally by enabled state or membership in a selection. It is the workhorse for enumerating what is in the session (the GUI object panel, exporters, and change-polling all use it).

## Syntax
`get_names(type='public_objects', enabled_only=0, selection='')`

| Param | Type | Default | Meaning |
| --- | --- | --- | --- |
| `type` | str | `'public_objects'` | Category (see below) |
| `enabled_only` | 0/1 | `0` | If `1`, only enabled (visible/active) names |
| `selection` | selection | `''` | Restrict to names touching this selection |

Valid `type` values map to internal modes: `objects` (1), `selections` (2), `all` (0), `public` (3), `public_objects` (4), `public_selections` (5), `public_nongroup_objects` (6), `public_group_objects` (7), `nongroup_objects` (8), `group_objects` (9). An unknown type raises `CmdException`.

## Behaviour
The `selection` is processed via `selector.process`; the `type` string is translated to an integer mode and `_cmd.get_names` is called with that mode plus `enabled_only` and the selection. "public" variants exclude underscore-prefixed internal names. The default returns only public object names.

## Examples
```python
cmd.get_names()                       # public objects
cmd.get_names("selections")           # selection names
cmd.get_names("objects", enabled_only=1)
```

## Related
- [get_names_of_type](./get_names_of_type.md)
- [get_type](../commands/get_type.md)
- [get_object_list](./get_object_list.md)

## Source
`packages/engine/modules/pymol/querying.py:1155`. Parity: implemented in `packages/engine-ts/src/cmd/editing.ts`; return type mapped to `string[]`.
