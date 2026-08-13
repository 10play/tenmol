---
name: get_selection_state
kind: command
category: querying
subcategory: object state
summary: Return the single effective object state shared by all objects in a selection, or raise if they differ.
parity: partial
---

## Purpose
`get_selection_state` resolves the effective state for every object touched by a
selection and returns it — but only if they all agree. Use it when an operation
must run in one consistent state and you want to fail fast if the selection spans
objects in different states.

## Syntax
`get_selection_state(selection)`

| Param | Type | Default | Meaning |
| --- | --- | --- | --- |
| `selection` | str | — | Atom selection |

## Behaviour
Builds the set of `get_object_state` values across the objects in the selection.
If the set has exactly one element, returns it. If empty (no objects), returns
`1`. If more than one distinct state is found, raises
`CmdException('Selection spans multiple object states')`.

## Examples
```python
state = cmd.get_selection_state("chain A")
```

## Related
- [get_object_state](get_object_state.md), [get_state](get_state.md)

## Source
`packages/engine/modules/pymol/querying.py:1519`. Parity: partial — registered at
`packages/engine-ts/src/cmd/xform.ts:202` but returns a constant `0` stub.
