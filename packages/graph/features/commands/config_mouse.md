---
name: config_mouse
kind: command
category: viewing-camera
subcategory: mouse configuration
summary: Selects the active mouse configuration ring (three/two/one-button preset family).
parity: implemented
---

## Purpose
`config_mouse` chooses which mouse-configuration ring is active, i.e. the family of button modes (three-button, two-button, one-button, and their viewing/editing/lights/maestro variants) that the `mouse` command then cycles through. Use it to match PyMOL's mouse bindings to your input device.

## Syntax
`config_mouse(ring='three_button', quiet=1)`

| Param | Type | Default | Meaning |
| --- | --- | --- | --- |
| `ring` | str | `'three_button'` | Name of the mouse configuration ring to activate |
| `quiet` | int | `1` | Suppress the confirmation print when `1` |

## Behaviour
Resolves `ring` against a shortcut table (`ring_dict_sc.auto_err`) so partial names auto-complete or raise. On a match it sets `button_mode` to 0, installs the chosen ring as the module-global `mouse_ring`, and calls `mouse(quiet=1)` to apply the first mode in that ring. Unrecognised rings print an error and make no change. Known rings include `three_button`, `three_button_viewing`, `three_button_editing`, `three_button_lights`, `three_button_maestro`, `two_button`, and `one_button`.

## Examples
```python
config_mouse three_button
config_mouse two_button
config_mouse one_button
```

## Related
- [mouse](../commands/mouse.md)
- [button](../commands/button.md)

## Source
`packages/engine/modules/pymol/controlling.py:168` (`def config_mouse`). Ported: `packages/engine-ts/src/cmd/controlflow.ts:235` records the named configuration.
