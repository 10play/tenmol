---
name: full_screen
kind: command
category: ui-gui
subcategory: window mode
summary: Enables or disables full-screen mode for the viewer window.
parity: unknown
---

## Purpose
`full_screen` toggles (or explicitly sets) full-screen display of the PyMOL viewer window, useful for presentations and maximizing the render area.

## Syntax
`full_screen(toggle=-1)`

| Param | Type | Default | Meaning |
| --- | --- | --- | --- |
| `toggle` | int/str | `-1` | -1 = toggle; `on`/1 = enable; `off`/0 = disable |

## Behaviour
With the default `toggle=-1` it flips the current state; `on`/`off` set it explicitly. Per the upstream note, this does not work correctly on all platforms - if it misbehaves, use the window's maximize button instead.

## Examples
```python
full_screen
full_screen on
full_screen off
```

## Related
- [viewport](viewport.md) - set the render viewport size

## Source
`packages/engine/modules/pymol/viewing.py` (`def full_screen`). Parity: not registered as an engine-ts command.
