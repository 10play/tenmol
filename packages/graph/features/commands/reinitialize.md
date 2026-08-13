---
name: reinitialize
kind: command
category: control-flow-system
subcategory: session lifecycle
summary: Reset PyMOL by deleting all objects and restoring default settings (with selectable scope).
parity: implemented
---

## Purpose
`reinitialize` resets PyMOL to a clean state, deleting all objects and restoring
default program settings. Use it to start over within a session; a scoped variant
lets you reset only settings without discarding structures.

## Syntax
`reinitialize(what='everything', object='')`

| Param | Type | Default | Meaning |
| --- | --- | --- | --- |
| `what` | string | `'everything'` | scope of the reset (see codes below) |
| `object` | string | `''` | limit certain resets to a named object |

## Behaviour
`what` is resolved through the `reinit_sc`/`reinit_code` shortcut table to an
integer code: `everything=0`, `settings=1`, `store_defaults=2`,
`original_settings=3`, `purge_defaults=4`. With `everything` (default) all objects
are deleted and settings return to defaults. `settings` restores settings while
keeping objects; `store_defaults`/`original_settings`/`purge_defaults` manage the
default-settings baseline used when loading sessions. These codes back the File >
Reinitialize menu items.

## Examples
```
reinitialize
reinitialize settings
reinitialize original_settings
```

## Related
- [delete](../commands/delete.md)
- [set](../commands/set.md)

## Source
`packages/engine/modules/pymol/commanding.py` (`def reinitialize`); reinit codes
in `packages/engine/layer1/Setting.cpp` (docs/feature-parity.md "Session /
defaults lifecycle"). Parity: implemented in
`packages/engine-ts/src/cmd/system.ts:108`.
