---
name: sculpt_iterate
kind: command
category: sculpting-minimization
subcategory: sculpting
summary: Runs a fixed number of local-geometry energy-minimization cycles on a sculpting-activated object.
parity: implemented
---

## Purpose
`sculpt_iterate` performs a simple energy minimization of atomic coordinates using the geometry restraints defined by `sculpt_activate` and enabled through the `sculpt_field_mask` setting. It is the workhorse behind PyMOL's real-time sculpting: each call nudges atoms toward their reference bond lengths, angles, and dihedrals while resolving VDW clashes.

## Syntax
`sculpt_iterate(object, state=-1, cycles=10)`

| Param | Type | Default | Meaning |
| --- | --- | --- | --- |
| `object` | str | — | name of a single object, or `"all"` |
| `state` | int | `-1` | object state; `-1` = current state, `0` = all states |
| `cycles` | int | `10` | number of minimization iterations |

## Behaviour
Only local geometry restraints and VDW repulsion are modelled — there is no solvation or electrostatics. The active restraint terms are selected by the `sculpt_field_mask` setting, and the whole feature is gated by the `sculpting` setting plus the family of `sculpt_*` settings. Note the state convention changed in PyMOL 2.5: `-1` now means "current state" (previously `0` served that role); `0` now means "all states". Returns the resulting energy value; a no-op if the object was not activated with `sculpt_activate`.

## Examples
```python
sculpt_activate mol
sculpt_iterate mol, cycles=50
sculpt_iterate all, state=0, cycles=20
```

## Related
- [sculpt_activate](sculpt_activate.md) — record reference geometry first
- [sculpt_deactivate](sculpt_deactivate.md) — stop sculpting

## Source
Upstream: `packages/engine/modules/pymol/editing.py:240`. Parity: implemented at `packages/engine-ts/src/cmd/sculpt.ts:348` (reads restraint cache, runs `minimizeCoords`, returns energy).
