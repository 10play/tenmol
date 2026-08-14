---
name: symmetry_copy
kind: command
category: symmetry
subcategory: cell/spacegroup transfer
summary: Copies symmetry information (unit cell and space group) from one object to another.
parity: implemented
---

## Purpose
`symmetry_copy` transfers crystallographic symmetry — the unit cell and space
group — from a source object to one or more targets. Use it when a structure was
loaded without cell metadata (or from a format that dropped it) so downstream
tools like `symexp` can work.

## Syntax
`symmetry_copy(source_name, target_name, source_state=1, target_state=1, quiet=1)`

| Param | Type | Default | Meaning |
| --- | --- | --- | --- |
| `source_name` | str | — | Object to copy symmetry from. |
| `target_name` | str | — | Object name pattern to copy symmetry to. |
| `source_state` | int | `1` | Source state (maps only). |
| `target_state` | int | `1` | Target state (maps only). |
| `quiet` | int | `1` | Suppress feedback when set. |

## Behaviour
`target_name` is a pattern, so multiple objects can receive the symmetry in one
call. State arguments matter only for map objects — molecular objects do not yet
support per-state symmetry — and are 1-based at the API, decremented internally.

## Examples
```
symmetry_copy 1abc, mymap
symmetry_copy xtal, model*
```

## Related
- [symexp](../commands/symexp.md)
- [set_symmetry](../commands/set_symmetry.md)

## Source
`packages/engine/modules/pymol/editing.py:412`. Parity: implemented — registered
in `packages/engine-ts/src/cmd/symmetry.ts:181`.
