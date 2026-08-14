---
name: get_setting_boolean
kind: command
category: settings
subcategory: setting introspection
summary: Read a single setting's value coerced to a Python boolean.
parity: implemented
---

## Purpose
`get_setting_boolean` returns the current value of a named setting as a boolean,
optionally scoped to a specific object and state. It is the boolean-typed member
of the `get_setting_*` family used internally by the GUI and by scripts that need
an on/off setting value rather than the raw tuple.

## Syntax
`get_setting_boolean(name, object='', state=0)`

| Param | Type | Default | Meaning |
| --- | --- | --- | --- |
| `name` | str/int | — | Setting name or numeric index |
| `object` | str | `''` | Object to read the setting from; `''` = global setting |
| `state` | int | `0` | State index (1-based; `0` = object/global level) |

## Behaviour
The name is resolved to a setting index via `_get_index`, then the C layer is
asked for the value coerced to `cSetting_boolean`. `state` is passed to the engine
as `state - 1` (so the default `0` means the object/global setting, not a
per-state override). Marked `# INTERNAL` — it is a typed accessor beneath the
higher-level `get`.

## Examples
```python
cmd.get_setting_boolean("orthoscopic")
cmd.get_setting_boolean("cartoon_smooth_loops", "myprot")
```

## Related
- [get_setting_int](get_setting_int.md), [get_setting_float](get_setting_float.md), [get](get.md), [set](set.md)

## Source
`packages/engine/modules/pymol/setting.py:420`. Parity: implemented — the
`get_setting_*` accessor family is available/consumed in
`packages/engine-ts/src/cmd/movie3.ts`.
