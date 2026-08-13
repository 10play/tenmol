---
name: edit_mode
kind: command
category: editing-building
subcategory: mouse mode
summary: Switches the mouse into (or out of) editing mode within the current mouse ring.
parity: implemented
---

## Purpose
`edit_mode` toggles the mouse between viewing and editing configurations for the current button scheme, so mouse drags manipulate atoms/bonds instead of the camera. It is a legacy convenience wrapper around `mouse`.

## Syntax
`edit_mode(active=1, quiet=1)`

| Param | Type | Default | Meaning |
| --- | --- | --- | --- |
| `active` | 0/1 | `1` | 1 = enter editing mode, 0 = return to viewing mode |
| `quiet` | 0/1 | `1` | Suppress feedback |

## Behaviour
Boolean-string `active` values are resolved via the boolean shortcut. It reads the `button_mode` setting and, for two- and three-button schemes, calls `mouse(action=...)` to swap between the `*_editing` and `*_viewing` variants (e.g. `three_button_viewing` ↔ `three_button_editing`) only if not already in the target mode. It always returns success and takes no action for mouse rings without an editing variant.

## Examples
```python
edit_mode          # enter editing mode
edit_mode 0        # back to viewing mode
```

## Related
- [edit](./edit.md)
- [drag](./drag.md)
- [mouse](../commands/mouse.md)

## Source
`packages/engine/modules/pymol/controlling.py:688`. Parity: implemented in `packages/engine-ts/src/cmd/extras.ts`.
