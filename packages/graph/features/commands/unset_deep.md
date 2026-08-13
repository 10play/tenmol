---
name: unset_deep
kind: command
category: settings
subcategory: bulk setting reset
summary: Unsets all object, object-state, atom, and bond level settings across objects.
parity: partial
---

## Purpose
`unset_deep` bulk-clears setting overrides at every level (object, object-state, atom, bond) so the objects fall back to global/default values. Reach for it to wipe a session's accumulated per-object customisations in one call.

## Syntax
`unset_deep(settings='', object='*', updates=1, quiet=1)`

| Param | Type | Default | Meaning |
| --- | --- | --- | --- |
| `settings` | str | `''` | space-separated setting names, or empty for all settings |
| `object` | str | `'*'` | one object name, or `*` for all objects |
| `updates` | int | `1` | rebuild the object(s) afterwards |
| `quiet` | int | `1` | suppress per-setting failure messages |

## Behaviour
It iterates the requested settings (all indices when `settings` is empty) and, for each object-level state `0` plus each object-state `1..N` (from `count_states`), calls `unset` with `updates=0`; if the target is a group or molecule it also unsets against the object's atom selection to catch atom/bond-level overrides. It does **NOT** currently unset atom-*state* level settings — inspect those with `iterate_state 1, *, print(list(s))` and delete by index via `alter_state`. When `updates` is set it finishes with `rebuild(object)`.

## Examples
```python
# reset everything on one object
unset_deep , 1abc

# reset just two settings across all objects
unset_deep cartoon_transparency stick_radius
```

## Related
- [unset](../commands/unset.md)
- [unset_bond](../commands/unset_bond.md)

## Source
`packages/engine/modules/pymol/setting.py:516`. Parity: registered as a documented no-op in `packages/engine-ts/src/cmd/extras.ts`.
