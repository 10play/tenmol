---
name: select_list
kind: command
category: selecting
subcategory: named selections
summary: API-only command that selects atoms of one object by an explicit list of IDs, indices, or ranks.
parity: planned
---

## Purpose
`select_list` creates a named selection from an explicit list of atom identifiers within a single object — bypassing the selection-language parser entirely. It is an API-only helper meant for programmatic use where you already hold atom IDs/indices and want a fast, unambiguous selection.

## Syntax
`select_list(name, object, id_list, state=0, mode='id', quiet=1)`

| Param | Type | Default | Meaning |
| --- | --- | --- | --- |
| `name` | str | — | a unique name for the selection |
| `object` | str | — | the object to select within |
| `id_list` | list[int] | — | ID, index, or rank values to select |
| `state` | int | `0` | limit to atoms with coordinates in this state; `-1` = current, `0` = ignore |
| `mode` | `id\|index\|rank` | `'id'` | how to interpret `id_list` |
| `quiet` | int | `1` | suppress console feedback |

## Behaviour
`mode` chooses the identifier semantics: `id` matches the atom's stored ID, `index` matches the internal 1-based atom index, and `rank` matches the load-order rank. When `state` is non-zero, atoms lacking coordinates in that state are excluded. Returns the number of atoms selected. This is not a command-line verb — call it from Python via `cmd.select_list(...)`.

## Examples
```python
cmd.select_list("core", "1abc", [10, 11, 12], mode="index")
cmd.select_list("byid", "prot", [100, 205], mode="id", state=1)
```

## Related
- [select](select.md) — the general selection-expression command

## Source
Upstream: `packages/engine/modules/pymol/selecting.py:149`. Parity: not ported to the TS engine (no `select_list` registration); planned.
