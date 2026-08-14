---
name: get_dihedral
kind: command
category: measurement
subcategory: geometry query
summary: Returns the dihedral (torsion) angle in degrees between four atoms.
parity: implemented
---

## Purpose
`get_dihedral` computes the dihedral angle formed by four atoms, reading coordinates from the current (or a specified) state. Reach for it when you need a numeric torsion value programmatically rather than a drawn `dihedral` measurement object.

## Syntax
`get_dihedral(atom1='pk1', atom2='pk2', atom3='pk3', atom4='pk4', state=-1, quiet=1)`

| Param | Type | Default | Meaning |
| --- | --- | --- | --- |
| `atom1` | selection | `'pk1'` | First atom (single-atom selection) |
| `atom2` | selection | `'pk2'` | Second atom |
| `atom3` | selection | `'pk3'` | Third atom |
| `atom4` | selection | `'pk4'` | Fourth atom |
| `state` | int | `-1` | Coordinate state; `-1` = current state |
| `quiet` | 0/1 | `1` | If `0`, prints the angle to the feedback log |

## Behaviour
Each selection is passed through `selector.process` and must resolve to a single atom. By convention, positive dihedral angles are right-handed when looking down the atom2→atom3 axis. The value is returned as a float in degrees; with `quiet=0` it also prints `cmd.get_dihedral: <n> degrees.`. Internally dispatches to `_cmd.get_dihe` with a zero-based `state-1`.

## Examples
```python
get_dihedral 4/n, 4/c, 4/ca, 4/cb
get_dihedral 4/n, 4/c, 4/ca, 4/cb, state=4
phi = cmd.get_dihedral("1/C","2/N","2/CA","2/C")
```

## Related
- [get_angle](../commands/get_angle.md)
- [get_distance](./get_distance.md)
- [set_dihedral](../commands/set_dihedral.md)

## Source
`packages/engine/modules/pymol/querying.py:1023`. Parity: implemented in `packages/engine-ts/src/cmd/dashes.ts`.
