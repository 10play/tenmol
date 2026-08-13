---
name: split_states
kind: command
category: movies-scenes-states
subcategory: state splitting
summary: Separates a multi-state molecular object into a set of single-state objects.
parity: implemented
---

## Purpose
`split_states` explodes a multi-state object (an NMR ensemble, a docking result,
a trajectory) into one object per state. It is the inverse of `join_states` and
the usual way to treat individual models as independent objects.

## Syntax
`split_states(object, first=1, last=0, prefix=None)`

| Param | Type | Default | Meaning |
| --- | --- | --- | --- |
| `object` | string | — | Object (or selection) to split. |
| `first` | int | `1` | First state to extract. |
| `last` | int | `0` | Last state to extract; `0` = through the final state. |
| `prefix` | string | `None` | Name prefix; if omitted, names use the object title or `<object>_NNNN`. |

## Behaviour
Selections are supported, not just object names. For each matched object it counts
states, clamps `last` to the available range, and creates a new object per state.
When `prefix` is given, outputs are numbered `<prefix>0001`... When it is omitted,
the command tries the per-state title (via `get_title`); if none exists it falls
back to `<object>_NNNN`. Name collisions are resolved with `get_unused_name`.

## Examples
```
load docking_hits.sdf
split_states docking_hits, prefix=hit
delete docking_hits
```

## Related
- [join_states](../commands/join_states.md)
- [split_chains](../commands/split_chains.md)
- [create](../commands/create.md)

## Source
`packages/engine/modules/pymol/editing.py:175`. Parity: implemented — registered
in `packages/engine-ts/src/cmd/extras.ts:288`.
