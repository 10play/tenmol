---
name: button
kind: command
category: ui-gui
subcategory: mouse configuration
summary: Redefines what a mouse button plus modifier does in the viewport.
parity: implemented
---

## Purpose
`button` remaps the action performed by a given mouse button and keyboard
modifier combination inside the 3D viewport. Reach for it to customize mouse
behavior beyond the presets cycled by the mouse-mode indicator.

## Syntax
`button(button, modifier, action)`

| Param | Type | Default | Meaning |
| --- | --- | --- | --- |
| `button` | str | — | `left`, `middle`, `right`, `wheel`, or `double_`/`single_` variants. |
| `modifier` | str | — | `None`, `Shft`, `Ctrl`, `CtSh`, `CtAl`, `CtAS`, etc. |
| `action` | str | — | e.g. `Rota`, `Move`, `MovZ`, `Slab`, `Clip`, `Sele`, `Orig`, `Menu`, `PkAt`, `Pk1`, `RotZ`, `ClpN`, `ClpF`. |

## Behaviour
Each argument is lower-cased and resolved through a shortcut table
(`button_sc`, `but_mod_sc`, `but_act_sc`), so unambiguous abbreviations work and
unknown values raise. The button and modifier are combined into a numeric
"button code" (normal L/M/R buttons, wheel, and single/double clicks each use a
different encoding branch) which, with the action code, is applied via
`_cmd.button`. Note that changes are easily overridden when the user cycles
through mouse modes. Obsolete actions (`lb`, `mb`, `rb`, ...) and several
internal/future actions (`RotD`, `MovD`, ...) are recognized but unsupported.

## Examples
```
button middle, none, move
button wheel, ctrl, slab
button left, shft, sele
```

## Related
- [config_mouse](../commands/config_mouse.md)
- [mouse](../commands/mouse.md)

## Source
`packages/engine/modules/pymol/controlling.py:799`. Referenced in the TS backend
(`packages/engine-ts/src/backend.ts`) and registered as `button`.
