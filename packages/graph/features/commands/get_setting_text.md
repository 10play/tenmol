---
name: get_setting_text
kind: command
category: settings
subcategory: setting introspection
summary: Read a single setting's value coerced to a text/string form.
parity: internal
---

## Purpose
`get_setting_text` returns the current value of a named setting coerced to
`cSetting_string` — a human-readable text form of the value. It is the
string-typed member of the `get_setting_*` family, used where a display string
of a setting is wanted rather than a number or tuple.

## Syntax
`get_setting_text(name, object='', state=0)`

| Param | Type | Default | Meaning |
| --- | --- | --- | --- |
| `name` | str/int | — | Setting name or numeric index |
| `object` | str | `''` | Object to read the setting from; `''` = global setting |
| `state` | int | `0` | State index (1-based; `0` = object/global level) |

## Behaviour
Resolves `name` to a setting index and requests the value as a string via
`get_setting_of_type(..., cSetting_string)`, with `state` forwarded as
`state - 1`. Marked `# INTERNAL`.

## Examples
```python
cmd.get_setting_text("bg_rgb")
cmd.get_setting_text("label_font_id", "myprot")
```

## Related
- [get_setting_tuple](get_setting_tuple.md), [get_setting_float](get_setting_float.md)

## Source
`packages/engine/modules/pymol/setting.py:435`. Parity: internal — INTERNAL
typed accessor; no dedicated TypeScript port found.
