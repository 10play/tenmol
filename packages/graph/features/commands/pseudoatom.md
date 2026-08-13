---
name: pseudoatom
kind: command
category: editing-building
subcategory: atom creation
summary: Adds a pseudoatom (marker/label point) to a molecular object, creating it if needed.
parity: implemented
---

## Purpose
`pseudoatom` places a synthetic atom at a chosen 3D point (or at the center of a
selection), creating the target object if it does not exist. It is the go-to tool
for planting labels, distance anchors, centroids or arbitrary markers in space.

## Syntax
```
pseudoatom(object='', selection='', name='PS1', resn='PSD', resi='1', chain='P',
           segi='PSDO', elem='PS', vdw=-1.0, hetatm=1, b=0.0, q=0.0, color='',
           label='', pos=None, state=0, mode='rms', quiet=1)
```

| Param | Type | Default | Meaning |
| --- | --- | --- | --- |
| `object` | str | `''` | target object name (created if absent) |
| `selection` | str | `''` | atoms whose position defines the pseudoatom location |
| `name` | str | `'PS1'` | atom name |
| `resn` | str | `'PSD'` | residue name |
| `resi` | str | `'1'` | residue identifier |
| `chain` | str | `'P'` | chain identifier |
| `segi` | str | `'PSDO'` | segment identifier |
| `elem` | str | `'PS'` | element symbol |
| `vdw` | float | `-1.0` | VDW radius (-1 = default) |
| `hetatm` | int | `1` | flag as HETATM |
| `b` | float | `0.0` | B-factor |
| `q` | float | `0.0` | occupancy |
| `color` | str | `''` | color name/index for the atom |
| `label` | str | `''` | text label to attach |
| `pos` | list | `None` | explicit `[x,y,z]` position |
| `state` | int | `0` | coordinate state |
| `mode` | str | `'rms'` | how a selection is reduced to a point (e.g. `rms`) |
| `quiet` | int | `1` | suppress feedback |

## Behaviour
If `color` is given it is resolved to a color index; empty means default (-1).
The `selection` is preprocessed and identifier strings are `unquote`d. When
`pos` is provided (a list/tuple, or a string that is `safe_list_eval`'d) it fixes
the coordinate; otherwise the selection center is used, reduced per `mode`
(resolved through the pseudoatom-mode shortcut). State is converted to 0-based.
Useful for a wide range of ad-hoc tasks where you need an atom or label somewhere
in space.

## Examples
```
pseudoatom mymark, pos=[10, 5, 3]
pseudoatom centers, chain A, name CEN
pseudoatom lbl, pos=[0,0,0], label="site A", color=yellow
```

## Related
- `label`, `distance`, `create` - markers, measurements and object creation

## Source
`packages/engine/modules/pymol/creating.py:1091`. Registered in the TS port at
`packages/engine-ts/src/cmd/editing.ts:490`.
