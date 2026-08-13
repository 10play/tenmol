---
name: reference
kind: command
category: editing-building
subcategory: reference state
summary: Manage a per-atom reference state (validate/store/recall/swap) for a selection.
parity: unknown
---

## Purpose
`reference` operates on an object's per-atom "reference" state — a stored set of
coordinates used as a baseline. Depending on the `action`, it validates, stores,
recalls, swaps, or clears reference coordinates for the selected atoms.

## Syntax
`reference(action='validate', selection='(all)', state=0, quiet=1)`

| Param | Type | Default | Meaning |
| --- | --- | --- | --- |
| `action` | string/int | `'validate'` | which reference operation to perform |
| `selection` | selection | `'(all)'` | atoms to act on |
| `state` | integer | `0` | state to operate on (0 = current) |
| `quiet` | | `1` | suppress feedback |

## Behaviour
`action` is resolved through the reference-action shortcut table
(`ref_action_sc`/`ref_action_dict`) to an integer code (e.g. validate) before
being passed to `_cmd.reference`. The selection is processed through the selector
and `state` is converted from 1-based to 0-based (0 stays as the current state).
The command has no descriptive docstring in the source; behaviour is defined by
the engine's reference-state handling.

## Examples
```
reference store, polymer
reference validate
```

## Related
- [set_geometry](../commands/set_geometry.md)

## Source
`packages/engine/modules/pymol/editing.py` (`def reference`). Parity: not
registered as a standalone command in `packages/engine-ts/src`.
