---
name: get_title
kind: command
category: movies-scenes-states
subcategory: state title
summary: Retrieve the text title associated with a particular object state.
parity: unknown
---

## Purpose
`get_title` returns the title string attached to a specific state of an object —
the text PyMOL displays while that state is active. Paired with `set_title`, it
is useful for labelling frames of a trajectory or docking poses.

## Syntax
`get_title(object, state, quiet=1)`

| Param | Type | Default | Meaning |
| --- | --- | --- | --- |
| `object` | str | — | Object name |
| `state` | int | — | State index (1-based) |
| `quiet` | int | `1` | If `0`, prints the retrieved title |

## Behaviour
Returns the stored title string, or `None` if no title is set for that state.
`state` is forwarded to the engine as `state - 1`. With `quiet=0` it prints
`get_title: <text>` when a title exists. Both `object` and `state` are required
positional arguments (no defaults).

## Examples
```python
cmd.set_title("traj", 1, "frame 1")
cmd.get_title("traj", 1)          # -> 'frame 1'
```

## Related
- [set_title](set_title.md), [get_state](get_state.md)

## Source
`packages/engine/modules/pymol/querying.py:176`. Parity: unknown — no direct
`get_title` export found in `packages/engine-ts/src`.
