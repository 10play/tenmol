---
name: get_object_settings
kind: command
category: querying
subcategory: settings introspection
summary: Query the per-object (and per-state) setting overrides stored on an object.
parity: unknown
---

## Purpose
`get_object_settings` returns the setting overrides stored directly on an object,
for a given state. It is an "unsupported" introspection helper for reading which
settings have been locally set on an object rather than inherited from the
global level.

## Syntax
`get_object_settings(object, state=0, quiet=1)`

| Param | Type | Default | Meaning |
| --- | --- | --- | --- |
| `object` | str | — | Object name whose settings are queried |
| `state` | int | `0` | State index; `0` (ALL_STATES) = object-level settings (passed as `state-1`) |
| `quiet` | int | `1` | Suppress console output |

## Behaviour
Locks the API and calls the C-layer `get_object_settings` with `state-1`. The
default `state=0` corresponds to `ALL_STATES` (object-level overrides). Documented
as an "unsupported command"; the signature and defaults are authoritative but the
returned structure is not a guaranteed-stable API.

## Examples
```python
cmd.get_object_settings("myprot")
cmd.get_object_settings("myprot", state=2)
```

## Related
- [get_setting_boolean](get_setting_boolean.md), [get_object_matrix](get_object_matrix.md)

## Source
`packages/engine/modules/pymol/querying.py:121`. Parity: unknown — not registered
in `packages/engine-ts/src`.
