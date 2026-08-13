---
name: set_state_order
kind: command
category: movies-scenes-states
subcategory: states
summary: API-only command to reorder the states of a multi-state object via an index array.
parity: implemented
---

## Purpose
`set_state_order` permutes the states (models/frames) of a multi-state object according to a supplied 1-based index array. Use it to reverse or re-sequence NMR ensembles or trajectory frames without rebuilding the object.

## Syntax
`set_state_order(name, order, quiet=1)`

| Param | Type | Default | Meaning |
| --- | --- | --- | --- |
| `name` | str | — | Object name |
| `order` | list of int | — | 1-based index array giving the new state order |
| `quiet` | int | `1` | Suppress feedback |

## Behaviour
API-only. The wrapper converts each 1-based index in `order` to 0-based (`i - 1`) before dispatching to `_cmd.set_state_order`. The `order` list should be a full permutation of the object's existing states; the resulting object presents its states in the given sequence.

## Examples
```python
# reverse the order of a 20-model object
cmd.set_state_order('1nmr', range(20, 0, -1))
```

## Related
- [split_states](./split_states.md)
- [set_title](./set_title.md)

## Source
`packages/engine/modules/pymol/editing.py:350`; signature in `docs/api-reference/commands.mdx:3703`. Parity: implemented in `packages/engine-ts/src/cmd/xform.ts`.
