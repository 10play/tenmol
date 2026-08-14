---
name: dihedral
kind: command
category: measurement
subcategory: angle measurement
summary: Creates a measurement object showing the dihedral (torsion) angle formed between four atoms.
parity: implemented
---

## Purpose
`dihedral` measures and displays the torsion angle defined by four atoms and stores it as a named measurement (distance-type) object. Reach for it to read out a chi/phi/psi-style dihedral interactively or from scripted selections.

## Syntax
`dihedral(name=None, selection1='(pk1)', selection2='(pk2)', selection3='(pk3)', selection4='(pk4)', mode=None, label=1, reset=0, zoom=0, state=0, quiet=1)`

| Param | Type | Default | Meaning |
| --- | --- | --- | --- |
| `name` | str | `None` | Name of the dihedral object; auto-generated (`dihedralNN`) when omitted |
| `selection1` | selection | `'(pk1)'` | First atom |
| `selection2` | selection | `'(pk2)'` | Second atom |
| `selection3` | selection | `'(pk3)'` | Third atom |
| `selection4` | selection | `'(pk4)'` | Fourth atom |
| `mode` | int | `None` | Measurement mode (defaults to 0) |
| `label` | 0/1 | `1` | Show the numeric angle label |
| `reset` | 0/1 | `0` | Reset/replace an existing object |
| `zoom` | 0/1 | `0` | Zoom to the measurement after creation |
| `state` | int | `0` | Object state (0 = all states) |
| `quiet` | 0/1 | `1` | Suppress feedback |

## Behaviour
With no arguments it uses the four picked atoms `(pk1)`–`(pk4)`; if any of those picked selections is undefined it errors ("The 'pkN' selection is undefined"). When `name` is omitted, PyMOL increments the `dist_counter` setting and names the object `dihedral%02d`. Each selection is run through `selector.process`; the `state` argument is converted to zero-based before the call. Note the upstream code has a copy-paste quirk where the `selection3=="(pk4)"` branch guards the fourth pick.

## Examples
```python
dihedral chi1, 12/N, 12/CA, 12/CB, 12/CG
dihedral            # uses the four Ctrl-middle-click picked atoms
```

## Related
- [distance](./distance.md)
- [angle](../commands/angle.md)
- [get_dihedral](../commands/get_dihedral.md)

## Source
`packages/engine/modules/pymol/querying.py:287`. Parity: implemented in `packages/engine-ts/src/cmd/dashes.ts` (`dihedral` measurement object).
