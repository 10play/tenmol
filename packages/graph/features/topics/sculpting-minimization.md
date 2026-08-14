---
name: sculpting-minimization
kind: feature
category: sculpting-minimization
subcategory: real-time sculpting & minimisation
summary: PyMOL's real-time geometry optimiser — the sculpt_* command cycle (activate/iterate/deactivate/purge), the minimize/fast_minimize/clean verbs, and the sculpt_* settings and force-field flags that govern which harmonic restraints are applied.
parity: partial
---

## Purpose

*Sculpting* is PyMOL's interactive, restraint-based geometry cleanup: it snapshots the current
bond lengths, angles and other local geometry of an object as a **reference**, then relaxes
coordinates back toward that reference (plus soft van-der-Waals repulsion) as you drag atoms or
build fragments. You reach for it in the Builder and Mutagenesis wizards to keep hand-edited
structures physically plausible without a full force field. The `minimize`/`clean` verbs are the
one-shot batch cousins, and the many `sculpt_*` settings tune which restraint terms are active and
how strongly. Sculpting supports only *local* geometry restraints and vdw repulsion — no solvation
or electrostatics.

## Syntax

The sculpt lifecycle is: `sculpt_activate` (snapshot reference) → repeated `sculpt_iterate`
(relax) → `sculpt_deactivate`/`sculpt_purge` (discard restraints). `set sculpting, 1` plus
`auto_sculpt` drives this automatically during interactive editing.

```
sculpt_activate object [, state [, match_state [, match_by_segment ]]]
sculpt_iterate  object [, state [, cycles ]]
sculpt_deactivate object
sculpt_purge
minimize [ sele [, iter [, grad [, interval ]]]]
clean selection [, ... ]
```

## sculpt_activate

Enables sculpting for `object` and remembers the current geometry (bond lengths, angles, etc.) of
the given state as the reference geometry. Restraints stay in effect until `sculpt_deactivate` or
`sculpt_purge`.

| Param | Type | Default | Meaning |
| --- | --- | --- | --- |
| `object` | str | | name of a single object or `"all"` |
| `state` | int | `0` | object state, or `0` for current state |
| `match_state` | int | `-1` | reference state to match against (`-1` = same as `state`) |
| `match_by_segment` | int | `0` | restrict restraint matching within segments |

In the TypeScript port `sculpt_activate(object, state=0)` snapshots the *current* geometry as
`r0`/`θ0` reference values and returns the number of bond + angle restraints created;
`match_state`/`match_by_segment` are accepted but not yet honoured.

## sculpt_iterate

Performs a simple energy minimization of atomic coordinates using the restraints defined at
`sculpt_activate` and selected by the `sculpt_field_mask` setting. Returns the strain energy.

| Param | Type | Default | Meaning |
| --- | --- | --- | --- |
| `object` | str | | name of a single object or `"all"` |
| `state` | int | `-1` | object state; `-1` = current state, `0` = all states (changed in PyMOL 2.5; `0` used to mean current) |
| `cycles` | int | `10` | number of minimization iterations |

The port runs steepest descent with a backtracking line search so the energy is monotonically
non-increasing; an already-minimal geometry is left untouched. It returns `0` if the object was
never activated. The number of cycles per interactive refresh is `sculpting_cycles`.

## sculpt_deactivate

Deactivates sculpting for `object` and clears the stored restraints. `object` may be `"all"`.
Returns non-zero on success in the port (`1` if a cached restraint set was removed).

| Param | Type | Default | Meaning |
| --- | --- | --- | --- |
| `object` | str | | name of a single object or `"all"` |

## sculpt_purge

Clears **all** cached restraint sets globally. Upstream this is documented as "an unsupported
feature"; the port implements it as a full flush of the sculpt cache (returns `None`).

## minimize

Batch energy minimization. Upstream `minimize` (in `experimenting.py`) is a nonfunctional stub that
routes to the `chempy.tinker` realtime engine and only runs if that force field is set up. The
TypeScript port re-implements `minimize(selection='all', state=0, cycles=500)` as a working
restraint minimiser that idealises toward **covalent-radius** bond lengths and reference angles,
returning the final energy.

| Param | Type | Default | Meaning |
| --- | --- | --- | --- |
| `sele` | str | `''` | selection to minimise (upstream; empty = first object) |
| `iter` | int | `500` | number of iterations |
| `grad` | float | `0.01` | gradient convergence threshold |
| `interval` | int | `50` | refresh interval (frames) |

(The port's `minimize` takes `selection, state, cycles=500` — it does not consume `grad`/`interval`.)

## fast_minimize

`fast_minimize(*args, **kwargs)` simply calls `minimize` with `_setup=0`, skipping the force-field
setup step. It is documented upstream as "an unsupported nonfunctional command that may eventually
have something to do with doing a quick clean up of the molecular structure." Not ported to the
TypeScript engine.

## clean

Runs energy minimization on a selection using an **MMFF94** force field.

| Param | Type | Default | Meaning |
| --- | --- | --- | --- |
| `selection` | str | | atoms to clean |
| `present` | str | `''` | atoms held present (context) |
| `state` | int | `-1` | object state |
| `fix` | str | `''` | atoms held fixed |
| `restrain` | str | `''` | atoms softly restrained |
| `method` | str | `'mmff'` | force-field method |
| `async_` | int | `0` | run asynchronously |
| `save_undo` | int | `1` | push an undo checkpoint |
| `message` | str | `None` | status message during the run |

**Gotcha:** in this open-source tree `cmd.clean` raises `pymol.IncentiveOnlyException`
(`computing.py:20`), so the Builder "Clean" button and `CleanWizard` are non-functional against the
real engine. The TypeScript port supplies an open-source substitute: `clean(selection, state,
cycles=100)` idealises toward covalent-radius bond lengths (same restraint minimiser as `minimize`,
fewer default cycles). `clean_electro_mode` (global int, default `1`) is the Builder's
"Electrostatics term for Clean" toggle.

## Force-field terms & the sculpt_field_mask flags

`sculpt_field_mask` is a bitmask (default `0x1FF`) selecting which restraint terms `sculpt_iterate`
applies. The flags are defined in `layer2/Sculpt.h`:

| Flag | Bit | Term | In default `0x1FF`? |
| --- | --- | --- | --- |
| `cSculptBond` | `0x001` | bond-length harmonic restraint | yes |
| `cSculptAngl` | `0x002` | 1-3 bond-angle restraint | yes |
| `cSculptPyra` | `0x004` | pyramidal (improper/chirality) restraint | yes |
| `cSculptPlan` | `0x008` | planarity restraint | yes |
| `cSculptLine` | `0x010` | linearity restraint | yes |
| `cSculptVDW` | `0x020` | van-der-Waals clash repulsion | yes |
| `cSculptVDW14` | `0x040` | 1-4 van-der-Waals repulsion | yes |
| `cSculptTors` | `0x080` | torsion restraint | yes |
| `cSculptTri` | `0x100` | 1-4 distance ("triangle") restraint | yes |
| `cSculptMin` | `0x200` | minimum-distance restraint | no |
| `cSculptMax` | `0x400` | maximum-distance restraint | no |
| `cSculptAvoid` | `0x800` | avoidance term | no |

Common masks used by the Builder radios: `0x01` (bonds only), `0x03` (bonds + angles), `0x1F`
(local geometry, no vdw), `0xFF`, and inverted masks like `~(0x20|0x40)` (turn vdw off). The
TypeScript port currently applies a fixed bond + 1-3 angle + soft-vdw-clash model with hard-coded
weights (`K_BOND=10`, `K_ANGLE=4`, `K_NB=4`, clash at 0.9× the vdw-radius sum) and does **not** yet
read `sculpt_field_mask` or the per-term weight settings.

## Control settings

| Setting | Type | Default | Meaning |
| --- | --- | --- | --- |
| `sculpting` | bool (ostate) | `0` | master switch: whether sculpting is performed |
| `auto_sculpt` | bool (global) | `0` | auto-activate sculpting when an atom is moved |
| `sculpting_cycles` | int (object) | `10` | iterations performed per interactive update |
| `sculpt_field_mask` | int (ostate) | `0x1FF` | bitmask of active restraint terms (see flags above) |
| `sculpt_memory` | bool (ostate) | `1` | reuse cached restraints across activations |
| `sculpt_nb_interval` | int (ostate) | `17` | cycles between nonbonded neighbour-list rebuilds |
| `sculpt_auto_center` | bool (global) | `0` | recenter the object after sculpting |

## Term-weight settings

Each weight scales the force contributed by its restraint term. All are per-object-state floats,
documented upstream as "undocumented and unsupported."

| Setting | Default | Term |
| --- | --- | --- |
| `sculpt_bond_weight` | `2.25` | bond length |
| `sculpt_angl_weight` | `1.0` | 1-3 bond angle |
| `sculpt_pyra_weight` | `1.0` | pyramidal (improper) |
| `sculpt_pyra_inv_weight` | `10.0` | pyramidal inversion penalty |
| `sculpt_plan_weight` | `1.0` | planarity |
| `sculpt_line_weight` | `1.0` | linearity |
| `sculpt_tors_weight` | `0.05` | torsion |
| `sculpt_tors_tolerance` | `0.05` | torsion angular tolerance before force applies |
| `sculpt_tri_weight` | `1.0` | 1-4 distance (triangle) |
| `sculpt_min_weight` | `0.75` | minimum-distance term |
| `sculpt_max_weight` | `0.75` | maximum-distance term |
| `sculpt_avd_weight` | `4.0` | avoidance term |
| `sculpt_vdw_weight` | `1.0` | vdw clash repulsion |
| `sculpt_vdw_weight14` | `0.2` | 1-4 vdw repulsion |

## VDW & distance-restraint settings

| Setting | Default | Meaning |
| --- | --- | --- |
| `sculpt_vdw_scale` | `0.97` | scale factor on the summed vdw radii used as the clash target |
| `sculpt_vdw_scale14` | `0.90` | vdw scale for 1-4 pairs |
| `sculpt_hb_overlap` | `1.0` | vdw overlap allowed for potential hydrogen bonds |
| `sculpt_hb_overlap_base` | `0.35` | base overlap for the H-bond allowance |
| `sculpt_tri_scale` | `1.025` | scale for the triangle (1-4) distance target |
| `sculpt_tri_min` | `2` | min sequence separation for triangle restraints |
| `sculpt_tri_max` | `18` | max sequence separation for triangle restraints |
| `sculpt_tri_mode` | `0` | triangle restraint mode selector |
| `sculpt_min_scale` | `0.975` | scale for the minimum-distance target |
| `sculpt_min_min` | `4.0` | lower bound of the min-distance term range |
| `sculpt_min_max` | `12.0` | upper bound of the min-distance term range |
| `sculpt_max_scale` | `1.025` | scale for the maximum-distance target |
| `sculpt_max_min` | `4.0` | lower bound of the max-distance term range |
| `sculpt_max_max` | `12.0` | upper bound of the max-distance term range |
| `sculpt_avd_gap` | `-1.0` | avoidance-term gap parameter (`-1` = auto) |
| `sculpt_avd_range` | `-1.0` | avoidance-term range parameter (`-1` = auto) |
| `sculpt_avd_excl` | `7` | avoidance-term exclusion depth (bonds) |

## VDW-contact visualization settings (bumps)

These drive the CGO "bumps" overlay showing vdw contacts during sculpting (the Builder "Bumps"
checkbox is bound to `sculpt_vdw_vis_mode`).

| Setting | Default | Meaning |
| --- | --- | --- |
| `sculpt_vdw_vis_mode` | `0` | show vdw contact CGO during sculpting (0 = off) |
| `sculpt_vdw_vis_min` | `-0.1` | overlap (Å) mapped to the low colour |
| `sculpt_vdw_vis_mid` | `0.1` | overlap (Å) mapped to the mid colour |
| `sculpt_vdw_vis_max` | `0.3` | overlap (Å) mapped to the high colour |

## Examples

```python
# Interactive: snapshot reference geometry, then relax 100 cycles
sculpt_activate 1ubq
set sculpting, 1
sculpt_iterate 1ubq, cycles=100
sculpt_deactivate 1ubq
```

```python
# Restrain only bonds + angles (no vdw) while editing
set sculpt_field_mask, 0x03
set auto_sculpt, 1        # sculpt automatically as atoms are dragged
```

```python
# One-shot idealisation toward covalent bond lengths (port's minimize)
minimize polymer, cycles=500
```

## Related

- [selection-algebra](../topics/selection-algebra.md) — the selection language every argument accepts
- `smooth` — window-averages coordinate states to damp trajectory vibrations (implemented in the same `sculpt.ts` subsystem)
- Builder / Sculpting / Mutagenesis wizards drive `sculpt_activate`/`sculpt_iterate` and the `sculpt_vdw_vis_mode` bumps overlay

## Source

- Commands: `packages/engine/modules/pymol/editing.py:104` (`sculpt_purge`), `:120` (`sculpt_deactivate`), `:144` (`sculpt_activate`), `:240` (`sculpt_iterate`)
- `minimize`/`fast_minimize`: `packages/engine/modules/pymol/experimenting.py:96,108`; `clean`: `packages/engine/modules/pymol/computing.py:20` (raises `IncentiveOnlyException`)
- Engine restraint solver: `packages/engine/layer2/Sculpt.cpp`, flags `packages/engine/layer2/Sculpt.h:25-36`
- Setting defaults: `packages/engine/layer1/SettingInfo.h:246-715`; help text `packages/engine/data/setting_help.csv`
- TypeScript parity port: `packages/engine-ts/src/cmd/sculpt.ts` (`sculpt_activate/iterate/deactivate/purge`, `minimize`, `clean`, `smooth`). Parity note: the port implements a bond + 1-3 angle + soft-vdw-clash model with fixed weights and does not yet honour `sculpt_field_mask` or the weight/scale settings; `fast_minimize` and the MMFF94 `clean` are not ported (the port substitutes covalent-radius idealisation).
