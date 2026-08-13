---
name: get_setting_legacy
kind: command
category: settings
subcategory: setting introspection
summary: Legacy alias of get_setting_float that reads a setting as a float.
parity: implemented
---

## Purpose
`get_setting_legacy` is a backward-compatibility alias for
[get_setting_float](get_setting_float.md). It exists so that old scripts and the
web/RPC surface can keep calling the historical name. Reach for
`get_setting_float` in new code.

## Syntax
`get_setting_legacy(name, object='', state=0)`

| Param | Type | Default | Meaning |
| --- | --- | --- | --- |
| `name` | str/int | — | Setting name or numeric index |
| `object` | str | `''` | Object to read the setting from; `''` = global setting |
| `state` | int | `0` | State index (1-based; `0` = object/global level) |

## Behaviour
Identical to `get_setting_float`: the name is resolved to an index and the value
is returned coerced to a float, with `state` forwarded as `state - 1`. It is
defined purely as an import alias (`get_setting_float as get_setting_legacy`) and
carries no distinct implementation.

## Examples
```python
cmd.get_setting_legacy("cartoon_transparency")
```

## Related
- [get_setting_float](get_setting_float.md), [get_setting_tuple](get_setting_tuple.md)

## Source
`packages/engine/modules/pymol/api.py:429` (alias of
`setting.py:430`). Parity: implemented via the shared `get_setting_float` path.
