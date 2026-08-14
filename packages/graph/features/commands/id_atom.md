---
name: id_atom
kind: command
category: querying
subcategory: atom identifiers
summary: Returns the source ID of a single atom, raising if zero or multiple atoms match.
parity: implemented
---

## Purpose
`id_atom` returns the original source ID of exactly one atom. Use it when you need the stable identifier of a specific, uniquely-resolved atom (source IDs survive add/delete, unlike indices).

## Syntax
`id_atom(selection, mode=0, quiet=1)`

| Param | Type | Default | Meaning |
| --- | --- | --- | --- |
| `selection` | selection | — | Must resolve to a single atom |
| `mode` | int | `0` | `0` = return id; `1` = return `(object, id)` tuple |
| `quiet` | 0/1 | `1` | If `0`, prints the resolved id |

## Behaviour
Internally calls `identify(selection, mode)`. If no atom matches it prints `cmd-Error: atom ... not found by id_atom` and raises `CmdException`; if more than one matches it prints `cmd-Error: multiple atoms ... found` and raises. On success returns the single id (or `(object, id)` when `mode=1`).

## Examples
```python
i = cmd.id_atom("1abc and chain A and resi 10 and name CA")
cmd.id_atom("pk1", mode=1)
```

## Related
- [identify](./identify.md)
- [index](./index.md)

## Source
`packages/engine/modules/pymol/querying.py:1242`. Parity: implemented in `packages/engine-ts/src/cmd/misc.ts`.
