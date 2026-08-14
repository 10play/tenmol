---
name: join_states
kind: command
category: movies-scenes-states
subcategory: state assembly
summary: Build a multi-state object from a selection spanning several objects — the reverse of split_states.
parity: implemented
---

## Purpose
Combine multiple objects (or the current states of several objects) into a single object with one
state per source. It is the inverse of `split_states` and is handy for turning a set of related
structures into an animatable trajectory.

## Syntax
`join_states(name, selection='all', mode=2, zoom=0, quiet=1)`

| Param | Type | Default | Meaning |
| --- | --- | --- | --- |
| `name` | string | — | name of the object to create or modify |
| `selection` | string | `'all'` | atoms to include in the new object |
| `mode` | int | `2` | how to match atoms across input objects (see below) |
| `zoom` | int | `0` | whether to zoom the new object |
| `quiet` | int | `1` | suppress feedback |

## Behaviour
`mode` controls atom matching:
- `0` — discrete object; inputs may be completely different.
- `1` — assume identical topology (same atom count and matching identifiers) across inputs.
- `2` (default) — match by atom identifiers but also drop atoms missing from any input, keeping
  only the common intersection.
- `3` — match atoms by sequence alignment (slowest, most robust; uses a temporary alignment
  object).

Implemented in Python by selecting per source object and repeatedly `create`-ing/`update`-ing
states onto `name`; it allocates temporary selection names via `get_unused_name` and cleans them
up afterward.

## Examples
```python
fragment ala
fragment his
join_states multi, (ala|his), mode=0
```

## Related
split_states, [create](create.md), [set_name](set_name.md)

## Source
`packages/engine/modules/pymol/creating.py:1145`. Parity: implemented in engine-ts
(`packages/engine-ts/src/cmd/extras.ts:321`).
