---
name: get_assembly_ids
kind: command
category: symmetry
subcategory: biological assembly
summary: Returns the list of biological assembly ids for an object loaded from mmCIF.
parity: partial
---

## Purpose
`get_assembly_ids` returns the list of assembly identifiers (`_pdbx_struct_assembly.id`) available for an object loaded from an mmCIF file. Reach for it to discover which biological assemblies you can request via the `assembly` setting before reloading.

## Syntax
`get_assembly_ids(name, quiet=1)`

| Param | Type | Default | Meaning |
| --- | --- | --- | --- |
| `name` | str | — | Object name (must have been loaded from mmCIF) |
| `quiet` | 0/1 | `1` | If `0`, prints ` Assembly IDs: <ids>` |

## Behaviour
Marked **EXPERIMENTAL AND SUBJECT TO CHANGE** upstream. Reads the CIF category array `_pdbx_struct_assembly.id` from the object's retained mmCIF data via `cif_get_array`. Returns a list of id strings (or a falsy/empty result if the object has no assembly records or was not loaded from mmCIF). With `quiet=0` the ids are printed comma-separated.

## Examples
```python
get_assembly_ids 1rx1
ids = cmd.get_assembly_ids("mystructure")
```

## Related
- [assembly](../settings/assembly.md)
- [symexp](../commands/symexp.md)

## Source
Upstream `packages/engine/modules/pymol/querying.py:1606`. Parity: partial — registered as `ctx.command('get_assembly_ids')` in `packages/engine-ts/src/cmd/symmetry.ts:191` but returns an empty list stub (CIF assembly arrays not yet retained).
