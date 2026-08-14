---
name: set_bond
kind: command
category: settings
subcategory: per-bond settings
summary: Changes per-bond settings for all bonds spanning two atom selections.
parity: implemented
---

## Purpose
`set_bond` is the per-bond analogue of `set`. It applies a setting to every bond that connects `selection1` to `selection2`. This is the only correct way to change bond-scoped visual settings such as stick radius, valence display, and stick transparency for a subset of bonds — the ordinary `set` command cannot target bonds.

## Syntax
`set_bond(name, value, selection1, selection2=None, state=0, updates=1, log=0, quiet=1)`

| Param | Type | Default | Meaning |
| --- | --- | --- | --- |
| `name` | str | — | name of the setting |
| `value` | str | — | new value to use |
| `selection1` | str | — | first set of atoms |
| `selection2` | str | `None` | second set; defaults to `selection1` (bonds internal to it) |
| `state` | int | `0` | object state |
| `updates` | int | `1` | trigger scene/geometry updates |
| `log` | int | `0` | echo the command into the log file |
| `quiet` | int | `1` | suppress console feedback |

## Behaviour
A bond qualifies when one endpoint is in `selection1` and the other in `selection2`; if `selection2` is omitted it falls back to `selection1`, affecting bonds wholly within that selection. Only a fixed set of settings are meaningful per-bond: `valence`, `line_width`, `line_color`, `stick_radius`, `stick_color`, and `stick_transparency`. Other settings may appear to accept the change but have no per-bond effect. Note that trying to apply these through `set` over an atom selection silently does nothing — hence `set_bond`.

## Examples
```python
set_bond stick_transparency, 0.7, */n+c+ca+o
set_bond stick_radius, 0.14, resn LIG
```

## Related
- [set](set.md) — global / per-object / per-atom settings
- [unset_bond](unset_bond.md) — clear a per-bond override

## Source
Upstream: `packages/engine/modules/pymol/setting.py:116`. Parity: implemented at `packages/engine-ts/src/cmd/settings2.ts:208`.
