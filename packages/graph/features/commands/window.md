---
name: window
kind: command
category: ui-gui
subcategory: window control
summary: Controls the visibility, position, and size of PyMOL's output window.
parity: implemented
---

## Purpose
`window` drives the top-level application window: show/hide it, move it,
resize it, maximize it, or push/pull focus. Reach for it in scripts that need to
place or reveal the GUI window programmatically (e.g. before a screenshot).

## Syntax
`window(action='show', x=0, y=0, width=0, height=0)`

| Param | Type | Default | Meaning |
| --- | --- | --- | --- |
| `action` | string | `'show'` | One of `show`, `hide`, `position`, `size`, `box`, `maximize`, `fit`, `focus`, `defocus`. |
| `x` | int | `0` | X coordinate (used by `position`/`box`). |
| `y` | int | `0` | Y coordinate (used by `position`/`box`). |
| `width` | int | `0` | Window width in pixels (used by `size`/`box`). |
| `height` | int | `0` | Window height in pixels (used by `size`/`box`). |

## Behaviour
`action` is resolved through `window_sc`/`window_dict`, which maps the keyword to
an integer code: `hide=0`, `show=1`, `position=2`, `size=3`, `box=4`,
`maximize=5`, `fit=6`, `focus=7`, `defocus=8`. An unknown/ambiguous action name
raises via the shortcut auto-completer. When a Qt window exists
(`pymol.gui.get_qtwindow()`), the call is forwarded to `qt_window.window_cmd`
(hide/show/move/resize/showMaximized/geometry-clamp/setFocus/clearFocus); the
geometry actions are no-ops while the window is maximized or fullscreen.
Otherwise it falls through to the C implementation `_cmd.window`. `box` combines
a position and a size in one call. All coordinates are cast to `int`.

## Examples
```
window hide
window position, 100, 100
window box, 0, 0, 1024, 768
```

## Related
- [viewport](../commands/viewport.md)
- [full_screen](../commands/full_screen.md)

## Source
`packages/engine/modules/pymol/viewing.py:1431`; action codes at
`packages/engine/modules/pymol/constants.py:150`. Parity: implemented — the
`window_cmd` / viewport / full_screen backend-window seam is a completed row in
`docs/feature-parity.md` (area 1).
