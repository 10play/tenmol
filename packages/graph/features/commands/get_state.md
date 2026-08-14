---
name: get_state
kind: command
category: movies-scenes-states
subcategory: state query
summary: Return the current state index (1-based).
parity: unknown
---

## Purpose
`get_state` returns the object state currently being displayed, as a 1-based
index. Use it to discover which conformation/frame's geometry is active before
acting on it in a script.

## Syntax
`get_state()`

Takes no arguments.

## Behaviour
Returns the current global state index (1-based). States are the distinct
geometric configurations an object can hold; by default states and movie frames
map one-to-one, but `mset` can decouple them so that frames visit states in an
arbitrary order. `get_state` reflects the state derived from the current frame,
not the raw frame number — see [get_frame](get_frame.md) for the latter.

## Examples
```python
st = cmd.get_state()
cmd.get_atom_coords("index 1", state=cmd.get_state())
```

## Related
- [get_frame](get_frame.md), [set_frame](set_frame.md), [mset](mset.md)

## Source
`packages/engine/modules/pymol/moving.py:958`. Parity: unknown — no direct
`get_state` export found in `packages/engine-ts/src`.
