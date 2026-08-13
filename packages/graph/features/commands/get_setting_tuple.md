---
name: get_setting_tuple
kind: command
category: settings
subcategory: setting introspection
summary: Read a setting as a (type, value) tuple with legacy value packaging.
parity: internal
---

## Purpose
`get_setting_tuple` returns a setting's value together with its type code as a
`(type, value)` tuple. It is the general-purpose accessor the GUI uses to read a
setting without knowing its type in advance — the feedback loop drives menu
sync by reading `get_setting_tuple(i)[1][0]`.

## Syntax
`get_setting_tuple(name, object='', state=0)`

| Param | Type | Default | Meaning |
| --- | --- | --- | --- |
| `name` | str/int | — | Setting name or numeric index |
| `object` | str | `''` | Object to read the setting from; `''` = global setting |
| `state` | int | `0` | State index (1-based; `0` = object/global level) |

## Behaviour
Delegates to `get_setting_tuple_new` (which calls
`get_setting_of_type(..., cSetting_tuple)` with `state - 1`). For legacy API
compatibility, if the returned type is not `cSetting_float3` the scalar value is
re-wrapped as a 1-tuple, so callers can uniformly index `value[0]`. Marked
`# INTERNAL`.

## Examples
```python
t = cmd.get_setting_tuple("sphere_scale")   # (type, (0.5,))
cmd.get_setting_tuple("bg_rgb")              # float3 -> (type, (r, g, b))
```

## Related
- [get_setting_updates](get_setting_updates.md), [get_setting_float](get_setting_float.md), [get_setting_int](get_setting_int.md)

## Source
`packages/engine/modules/pymol/setting.py:413`. Parity: internal — INTERNAL
accessor; no dedicated TypeScript port found.
