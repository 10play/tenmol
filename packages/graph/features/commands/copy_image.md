---
name: copy_image
kind: command
category: rendering-export
subcategory: image export
summary: Copies the current rendered image to the system clipboard (incentive/proprietary feature).
parity: internal
---

## Purpose
`copy_image` places the current viewport/rendered image onto the OS clipboard so it can be pasted into another application. It is an incentive (proprietary) feature in upstream PyMOL and depends on a GUI thread.

## Syntax
`copy_image(quiet=1)`

| Param | Type | Default | Meaning |
| --- | --- | --- | --- |
| `quiet` | int | `1` | Suppress status output when `1` |

## Behaviour
Dispatches to `_copy_image` on the GUI thread via `_call_in_gui_thread`. The actual clipboard write is a proprietary implementation and requires a running GUI; there is no open-source engine behaviour beyond the thread hand-off. Not usable in headless contexts.

## Examples
```python
copy_image
copy_image quiet=0
```

## Related
- [png](../commands/png.md)
- [ray](../commands/ray.md)

## Source
`packages/engine/modules/pymol/exporting.py:35` (`def copy_image`, marked "incentive feature / proprietary"). No TypeScript port. Internal/proprietary.
