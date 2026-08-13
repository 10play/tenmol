---
name: set
kind: command
category: settings
subcategory: settings
summary: Changes a global, per-object, per-object-state, or per-atom setting.
parity: implemented
---

## Purpose
`set` is the universal knob for PyMOL's ~800 settings. Depending on the `selection` and `state` arguments it targets the global store, an individual object, a specific state within an object, or per-atom setting entries. Reach for it to change appearance, rendering, and behaviour of essentially everything.

## Syntax
`set(name, value=1, selection='', state=0, updates=1, log=0, quiet=1)`

| Param | Type | Default | Meaning |
| --- | --- | --- | --- |
| `name` | str | — | setting name |
| `value` | str | `1` | the value to assign |
| `selection` | str | `''` | name-pattern or selection-expression; `''` = global |
| `state` | int | `0` | state number; `0` = object-level setting |
| `updates` | int | `1` | trigger scene/geometry updates |
| `log` | int | `0` | echo the command into the log file |
| `quiet` | int | `1` | suppress console feedback |

## Behaviour
A blank `selection` sets the global value. `"all"` writes the setting into every individual object; a specific object name writes that object's entry; a non-zero `state` targets a single state within the object. If `selection` is an atom selection-expression rather than an object name, the per-atom setting entries are modified — but only a fixed set are honoured per-atom: `sphere_color`, `surface_color`, `mesh_color`, `label_color`, `dot_color`, `cartoon_color`, `ribbon_color`, `transparency` (surfaces), and `sphere_transparency`. Per-bond settings do **not** work through `set` even though they appear to take — use `set_bond`. Omitting `value` defaults it to `1`, which conveniently toggles boolean settings on.

## Examples
```python
set orthoscopic
set line_width, 3
set surface_color, white, 1hpv
set sphere_scale, 0.5, elem C
```

## Related
- [set_bond](set_bond.md) — per-bond settings
- [get](get.md) — read a setting back
- [unset](unset.md) — restore the default

## Source
Upstream: `packages/engine/modules/pymol/setting.py:185`. Parity: implemented — the core global path is an engine builtin, and `packages/engine-ts/src/cmd/settings2.ts:108` registers the superset handler adding per-object overrides.
