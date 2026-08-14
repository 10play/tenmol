---
name: get_distance
kind: command
category: measurement
subcategory: geometry query
summary: Returns the distance in Angstroms between two atoms.
parity: implemented
---

## Purpose
`get_distance` returns the straight-line distance between two atoms, using coordinates from the current or a named state. Use it to read a pairwise distance numerically without creating a `distance` measurement object.

## Syntax
`get_distance(atom1='pk1', atom2='pk2', state=-1, quiet=1)`

| Param | Type | Default | Meaning |
| --- | --- | --- | --- |
| `atom1` | selection | `'pk1'` | First atom (single-atom selection) |
| `atom2` | selection | `'pk2'` | Second atom |
| `state` | int | `-1` | Coordinate state; `-1` = current state |
| `quiet` | 0/1 | `1` | If `0`, prints the distance to the feedback log |

## Behaviour
Both selections are run through `selector.process` and must each resolve to a single atom. Returns a float in Angstroms; with `quiet=0` prints `cmd.get_distance: <n> Angstroms.`. Delegates to `_cmd.get_distance` with a zero-based `state-1`.

## Examples
```python
get_distance 4/n, 4/c
get_distance 4/n, 4/c, state=4
d = cmd.get_distance("1/CA", "10/CA")
```

## Related
- [get_angle](../commands/get_angle.md)
- [get_dihedral](./get_dihedral.md)
- [distance](../commands/distance.md)

## Source
`packages/engine/modules/pymol/querying.py:958`. Parity: implemented in `packages/engine-ts/src/cmd/dashes.ts`.
