---
name: mouse
kind: command
category: ui-gui
subcategory: mouse configuration
summary: Cycles through the mouse modes in the current mouse configuration ring.
parity: implemented
---

## Purpose
`mouse` advances (or reverses) the active mouse-button mapping through the ring
of configured mouse modes (e.g. 3-Button Viewing, Editing, Motions). PyMOL runs
it automatically at start-up to initialize the button bindings.

## Syntax
```
mouse(action=None, quiet=1)
```

| Param | Type | Default | Meaning |
| --- | --- | --- | --- |
| `action` | str | `None` | `forward`, `backward`, `select_forward`, `select_backward`, or `None` to apply the current mode |
| `quiet` | int | `1` | suppress feedback |

## Behaviour
With `action='forward'`/`'backward'` it increments/decrements the `button_mode`
setting modulo the number of ring entries. `select_forward`/`select_backward`
step the `mouse_selection_mode` setting (wrapping 0..6). With `action=None` it
resolves the current `button_mode` into a named mode, sets `button_mode_name`,
and installs that mode's button bindings from the mode dictionary. Negative
`button_mode` values index the named mode list instead of the ring. Marked
INTERNAL upstream.

## Examples
```
mouse
mouse forward
mouse select_backward
```

## Related
- [move](move.md), [mplay](mplay.md) - other interactive/viewport commands

## Source
`packages/engine/modules/pymol/controlling.py:609`. Registered in the TS port at
`packages/engine-ts/src/cmd/controlflow.ts:229`.
