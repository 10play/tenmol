---
name: get_angle
kind: command
category: measurement
subcategory: geometry query
summary: Returns the angle in degrees defined by three atoms.
parity: implemented
---

## Purpose
`get_angle` computes the angle formed at `atom2` by three atoms, reading coordinates from the current (or a specified) state. Reach for it when you need a numeric angle value programmatically rather than a drawn `angle` measurement object.

## Syntax
`get_angle(atom1='pk1', atom2='pk2', atom3='pk3', state=-1, quiet=1)`

| Param | Type | Default | Meaning |
| --- | --- | --- | --- |
| `atom1` | selection | `'pk1'` | First atom (single-atom selection) |
| `atom2` | selection | `'pk2'` | Vertex atom |
| `atom3` | selection | `'pk3'` | Third atom |
| `state` | int | `-1` | Coordinate state; `-1` = current state |
| `quiet` | 0/1 | `1` | If `0`, prints the angle to the feedback log |

## Behaviour
Each selection is passed through `selector.process` and must resolve to a single atom. The value is returned as a float in degrees; with `quiet=0` it also prints ` cmd.get_angle: <n> degrees.`. Internally dispatches to `_cmd.get_angle` with a zero-based `state-1`.

## Examples
```python
get_angle 4/n, 4/c, 4/ca
get_angle 4/n, 4/c, 4/ca, state=4
a = cmd.get_angle("1/N", "1/CA", "1/C")
```

## Related
- [get_dihedral](../commands/get_dihedral.md)
- [get_distance](../commands/get_distance.md)
- [angle](../commands/angle.md)

## Source
Upstream `packages/engine/modules/pymol/querying.py:990`. Parity: implemented — registered as `ctx.command('get_angle')` in `packages/engine-ts/src/cmd/measurement.ts:172`.
