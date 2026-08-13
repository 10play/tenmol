---
name: get_setting_int
kind: command
category: settings
subcategory: setting introspection
summary: Read a single setting's value coerced to a Python int.
parity: implemented
---

## Purpose
`get_setting_int` returns the current value of a named setting as an `int`,
optionally scoped to a specific object and state. Use it when you need an integer
or boolean setting value (booleans come back as `0`/`1`) instead of the raw
tuple. It is the int-typed member of the `get_setting_*` family.

## Syntax
`get_setting_int(name, object='', state=0)`

| Param | Type | Default | Meaning |
| --- | --- | --- | --- |
| `name` | str/int | — | Setting name or numeric index |
| `object` | str | `''` | Object to read the setting from; `''` = global setting |
| `state` | int | `0` | State index (1-based; `0` = object/global level) |

## Behaviour
Resolves `name` to a setting index, then requests the value coerced to
`cSetting_int`. `state` is forwarded to the engine as `state - 1`. Enumerated and
boolean settings return their integer code. Marked `# INTERNAL`; the sibling
`get_setting_boolean` shares the same mechanism with a boolean coercion.

## Examples
```python
cmd.get_setting_int("max_threads")
cmd.get_setting_int("cartoon", "myprot")
```

## Related
- [get_setting_float](get_setting_float.md), [get_setting_tuple](get_setting_tuple.md)
- [get](get.md), [set](set.md)

## Source
`packages/engine/modules/pymol/setting.py:425`. Parity: implemented — a
`get_setting_int` accessor exists in `packages/engine-ts/src/cmd/movie3.ts`.
