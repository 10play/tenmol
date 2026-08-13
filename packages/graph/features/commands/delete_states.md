---
name: delete_states
kind: command
category: movies-scenes-states
subcategory: state removal
summary: Deletes specified states (by number or range) from object(s).
parity: implemented
---

## Purpose
`delete_states` removes individual coordinate states — or ranges of states — from one or more objects, without deleting the objects themselves. Use it to prune trajectory frames or unwanted NMR models.

## Syntax
`delete_states(name, states)`

| Param | Type | Default | Meaning |
| --- | --- | --- | --- |
| `name` | str | — | Name(s) of object(s); supports wildcards (`*`) |
| `states` | str | — | Space-separated list of state numbers and/or ranges |

## Behaviour
Parses `states` into a concrete list, expanding ranges written with a hyphen (e.g. `1-5`) and honouring descending ranges. State numbers are 1-based on input and converted to 0-based internally. Multiple tokens combine, so `1-3 10-40` deletes states 1–3 and 10–40. Applies to every object matching `name`.

## Examples
```python
delete_states 1nmr, 1-5
delete_states *, 1-3 10-40
```

## Related
- [delete](../commands/delete.md)
- [count_states](../commands/count_states.md)

## Source
`packages/engine/modules/pymol/commanding.py:548` (`def delete_states`). Ported: `packages/engine-ts/src/cmd/extras.ts:273` (`ctx.command('delete_states', ...)`).
