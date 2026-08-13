---
name: drag
kind: command
category: editing-building
subcategory: interactive coordinate editing
summary: Activates mouse dragging of a selection's atom coordinates, using camera-like mouse controls.
parity: unknown
---

## Purpose
`drag` puts a selection into an interactive drag mode so the user can translate/rotate the selected atoms' coordinates with the mouse (like moving the camera, but moving atoms). Calling it with no selection while dragging is active turns dragging off.

## Syntax
`drag(selection=None, wizard=1, edit=1, quiet=1, mode=-1)`

| Param | Type | Default | Meaning |
| --- | --- | --- | --- |
| `selection` | str | `None` | Atoms to drag; if omitted (and dragging active), deactivates dragging |
| `wizard` | 0/1 | `1` | Launch/attach the dragging wizard |
| `edit` | 0/1 | `1` | Switch the mouse into editing mode |
| `quiet` | 0/1 | `1` | Suppress feedback |
| `mode` | int | `-1` | Drag mode passed to the backend |

## Behaviour
When a non-empty selection is given it is run through `selector.process`, `edit`/`wizard` boolean strings are resolved, and the current `button_mode` is saved. The backend `_cmd.drag` arms dragging; on success `edit_mode(edit)` switches the mouse ring and, if `wizard` is set, the "dragging" wizard is instantiated (unless one is already active). With no/empty selection, `wizard` and `edit` are forced off and dragging is deactivated. All dragged atoms must reside in a single molecular object.

## Examples
```python
drag chain A          # start dragging chain A with the dragging wizard
drag                  # stop dragging
drag resi 50-60, edit=0, wizard=0
```

## Related
- [edit](./edit.md)
- [edit_mode](./edit_mode.md)
- [mouse](../commands/mouse.md)

## Source
`packages/engine/modules/pymol/editing.py:1020`. Parity: interactive drag mode not ported in the TypeScript engine slice.
