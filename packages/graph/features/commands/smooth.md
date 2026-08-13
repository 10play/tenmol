---
name: smooth
kind: command
category: editing-building
subcategory: trajectory
summary: Applies a moving-window average across coordinate states to damp high-frequency motion in a trajectory.
parity: implemented
---

## Purpose
`smooth` performs a sliding-window average of atom coordinates over states, suppressing high-frequency vibrations in a molecular-dynamics trajectory to reveal slower, larger-scale motions. Reach for it after loading a trajectory with `load_traj`.

## Syntax
`smooth(selection='all', passes=1, window=5, first=1, last=0, ends=0, quiet=1, cutoff=-1, pbc=1)`

| Param | Type | Default | Meaning |
| --- | --- | --- | --- |
| `selection` | string | `'all'` | Atoms to smooth |
| `passes` | int | `1` | Number of smoothing passes |
| `window` | int | `5` | Window size (states) for the average |
| `first` | int | `1` | First state to smooth (1-based) |
| `last` | int | `0` | Last state; 0 = through the end |
| `ends` | int | `0` | If 1, also smooth end states with a weighted asymmetric window |
| `quiet` | int | `1` | Suppress feedback |
| `cutoff` | float | `-1` | Distance cutoff for atom movement between two frames (keyword-only) |
| `pbc` | int (0/1) | `1` | Consider periodic boundary conditions (keyword-only) |

## Behaviour
`selection` is passed through the selector; `first` and `last` are decremented to 0-based indices before dispatch. `cutoff` and `pbc` are keyword-only arguments. With `ends=0` the terminal states are left unchanged, avoiding edge artifacts; `ends=1` smooths them with an asymmetric weighted window. Multiple `passes` compound the averaging. `pbc=1` wraps displacements across the periodic box so atoms crossing boundaries are handled correctly.

## Examples
```python
load_traj traj.dcd, prot
smooth prot, passes=3, window=7
smooth all, 1, 5, ends=1
```

## Related
- [load_traj](./load_traj.md)
- [set_state_order](./set_state_order.md)

## Source
`packages/engine/modules/pymol/editing.py:274`; signature in `docs/api-reference/commands.mdx:3819`. Parity: implemented in `packages/engine-ts/src/cmd/movie2.ts`.
