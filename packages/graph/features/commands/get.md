---
name: get
kind: command
category: settings
subcategory: setting query
summary: Prints and returns the current value of a global, per-object, or per-state setting.
parity: implemented
---

## Purpose
`get` retrieves the current value of a setting, optionally scoped to a specific object and state. It is the read counterpart to [set](../commands/set.md); reach for it to inspect the effective value of a setting from the command line or a script.

## Syntax
`get(name, selection='', state=0, quiet=1)`

| Param | Type | Default | Meaning |
| --- | --- | --- | --- |
| `name` | str | — | Setting name (or index) |
| `selection` | str | `''` | Object name; selections are not yet supported |
| `state` | int | `0` | State number (`0` = global/current) |
| `quiet` | 0/1 | `1` | If `0`, prints ` cmd.get: <name> = <value>` |

## Behaviour
`get` currently resolves only global, per-object, and per-state settings. Atom-level settings cannot be read this way — query those with `iterate` instead (e.g. `iterate all, print(s.line_width)`). The name is mapped to a setting index via `_get_index`, then read with `get_setting_text`. When `quiet=0` the value is printed; very long values are truncated for display. The typed value is returned to the caller.

## Examples
```python
get line_width
get sphere_scale, myprotein
w = cmd.get("cartoon_transparency")
```

## Related
- [set](../commands/set.md)
- [set_bond](../commands/set_bond.md)
- [get_bond](../commands/get_bond.md)

## Source
Upstream `packages/engine/modules/pymol/setting.py:353`. Parity: implemented — the setting read path is exercised internally (`ctx.call('get', …)`); the settings write/read APIs are marked done in `docs/feature-parity.md`.
