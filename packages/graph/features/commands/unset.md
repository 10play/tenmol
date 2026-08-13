---
name: unset
kind: command
category: settings
subcategory: setting reset
summary: Clears a setting and restores its default value (global, or per-object/state/atom).
parity: implemented
---

## Purpose
`unset` removes an explicit setting value so it reverts to its compiled-in default. With a selection it undefines per-object, per-state, or per-atom overrides; without one it resets the named global setting. Use it to back out a `set` you no longer want.

## Syntax
`unset(name, selection='', state=0, updates=1, log=0, quiet=1)`

| Param | Type | Default | Meaning |
| --- | --- | --- | --- |
| `name` | str | — | setting name (or index) to clear |
| `selection` | selection | `''` | scope; empty targets the global setting |
| `state` | int | `0` | state for per-state settings (0 = current/all) |
| `updates` | int | `1` | trigger scene updates |
| `log` | int | `0` | echo the equivalent `cmd.unset(...)` to the log |
| `quiet` | int | `1` | suppress feedback |

## Behaviour
It resolves `name` to a setting index via `_get_index`, then calls `_cmd.unset(_COb, index, selection, state-1, quiet, updates)`. WARNING (PyMOL 2.5 change): previously `unset settingname` for a *global* setting set its value to zero/off; it now restores the setting's true default. To force a global setting to zero use `set settingname, 0` instead. With a selection, per-object/state/atom overrides are undefined rather than zeroed.

## Examples
```python
unset orthoscopic
unset surface_color, 1hpv
unset sphere_scale, elem C
```

## Related
- [set](../commands/set.md)
- [unset_bond](../commands/unset_bond.md)
- [unset_deep](../commands/unset_deep.md)

## Source
`packages/engine/modules/pymol/setting.py:273`. Parity: implemented in `packages/engine-ts/src/cmd/settings2.ts`.
