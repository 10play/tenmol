---
name: view
kind: command
category: viewing-camera
subcategory: named camera views
summary: Saves and restores named camera views, optionally bound to function keys.
parity: unknown
---

## Purpose
`view` stores the current camera under a key and later recalls it, giving you lightweight named viewpoints without the full state machinery of `scene`. Keys `F1`–`F12` are auto-bound to their function keys for one-press recall.

## Syntax
`view(key, action='recall', animate=-1)`

| Param | Type | Default | Meaning |
| --- | --- | --- | --- |
| `key` | str | — | view name, or `*` to act on all stored views |
| `action` | str | `'recall'` | `store`, `recall`, `update`, or `clear` |
| `animate` | float | `-1` | animated transition duration on recall (`-1` = use default) |

## Behaviour
Views are kept in the per-session dict `pymol._view_dict`. `store`/`update` capture `get_view(0)` under `key`; `recall` applies the stored 18-float view via `set_view` with the given `animate`. `clear` deletes a single key, or with `key='*'` wipes all stored views; `action='*'`-target with a non-clear action lists the stored view names. Function-key auto-binding applies to `F1`–`F12` only when `set_key` has not overridden the key and no `scene` is defined for it.

## Examples
```python
view 0, store
view 0
view *, clear
```

## Related
- [scene](../commands/scene.md)
- [set_view](../commands/set_view.md)
- [get_view](../commands/get_view.md)

## Source
`packages/engine/modules/pymol/viewing.py:783`. Parity: the 18-float camera view is modelled in `packages/engine-ts/src/view/view.ts`, but the named-view `view` command itself is not yet registered in the TS port.
