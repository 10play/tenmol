---
name: load_coordset
kind: command
category: editing-building
subcategory: coordinate injection
summary: API-only loader that writes an Nx3 coordinate array into an object in original (file) atom order, appending a state when state=0.
parity: implemented
---

## Purpose
`load_coordset` loads an Nx3 coordinate array into an object using the **original**
atom order (the order atoms appeared in the source file), not the property-sorted
order. Reach for it when round-tripping coordinates alongside `get_coordset`, or to
append a new state built from externally computed positions.

## Syntax
`load_coordset(coords, object, state=0, quiet=1)`

| Param | Type | Default | Meaning |
| --- | --- | --- | --- |
| `coords` | list | — | Nx3 float array, one row per atom |
| `object` | str | — | destination object name |
| `state` | int | 0 | 1-based state to write, or 0 to append after the last state |
| `quiet` | int | 1 | suppress chatter |

## Behaviour
Unlike [load_coords](load_coords.md), rows map to atoms in the object's original
input order, making it the natural inverse of `get_coordset`. With `state=0` the
array is appended as a new state, which is how you grow a multi-state object frame
by frame. API only — no command-line form. In the TS port `load_coordset` delegates
to `load_coords` after resolving the target state.

## Examples
```python
cs = cmd.get_coordset("mol", 1)      # Nx3 in original order
cmd.load_coordset(cs, "mol", 0)      # append it as a new state
```

## Related
- [load_coords](load_coords.md) — same operation in atom-sorted order
- [load_traj](load_traj.md) — bulk trajectory frame loading

## Source
`packages/engine/modules/pymol/importing.py:1404` (`def load_coordset`). Implemented
in the TS port at `packages/engine-ts/src/cmd/xform.ts:176`.
