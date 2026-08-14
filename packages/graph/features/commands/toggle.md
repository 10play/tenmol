---
name: toggle
kind: command
category: representations-display
subcategory: representation visibility
summary: Toggles the visibility of a representation within an atom selection.
parity: unknown
---

## Purpose
`toggle` flips a representation on or off for a selection in a single call — a
convenient combination of `show` and `hide` bound to one verb, useful for
interactive scripts and keyboard shortcuts.

## Syntax
`toggle(representation='lines', selection='all')`

| Param | Type | Default | Meaning |
| --- | --- | --- | --- |
| `representation` | string | `'lines'` | Named representation (e.g. `lines`, `sticks`, `cartoon`), or `object` to toggle whole-object visibility. |
| `selection` | string | `'all'` | Atom selection. |

## Behaviour
If the representation is currently enabled for **any** atom in the selection, the
whole selection is turned off; otherwise it is turned on. The special value
`object` maps to representation mask `-2` (toggles the object's on/off state); all
other names are resolved via `_rep_to_repmask` and the selection is preprocessed
before dispatch.

## Examples
```
toggle sticks, chain A
toggle cartoon
toggle object, myObj
```

## Related
- [show](../commands/show.md)
- [hide](../commands/hide.md)

## Source
`packages/engine/modules/pymol/viewing.py:466`. Parity: unknown — no dedicated
`toggle` representation command was found in `packages/engine-ts/src` (distinct
from the `stereo`/`rock` toggle arguments).
