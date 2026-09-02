---
name: toggle
kind: command
category: representations-display
subcategory: representation visibility
summary: Toggles the visibility of a representation within an atom selection.
parity: implemented
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
`packages/engine/modules/pymol/viewing.py:466`. Parity: `packages/engine-ts/src/cmd/settings2.ts`
registers `toggle` — it flips a representation's visibility across the selection and returns
`None`, matching the real-PyMOL GL oracle (verified — `packages/graph/verify/probes/command__toggle.json`).
Non-representation names fall through to an engine-only setting-toggle extension.
