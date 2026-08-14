---
name: disable
kind: command
category: objects-groups
subcategory: visibility toggle
summary: Turns off display of one or more objects and/or selection indicators.
parity: implemented
---

## Purpose
`disable` hides objects (and selection indicator dots) from the 3D viewer without deleting them or changing which representations are shown. It is the inverse of `enable` and complements `hide` (which affects representations rather than the whole object's on/off state).

## Syntax
`disable(name='all')`

| Param | Type | Default | Meaning |
| --- | --- | --- | --- |
| `name` | str | `'all'` | Name-pattern or selection expression to disable |

## Behaviour
If `name` begins with `(` it is treated as a selection expression: it is run through `selector.process` and `_cmd.onoff_by_sele` disables every object with atoms in that selection. Otherwise `name` is treated as a name pattern and dispatched to `_cmd.onoff` (with the off flag). Disabling an object removes it from the display but preserves its representations, colors and state, so a later `enable` restores exactly what was showing.

## Examples
```python
disable            # disable everything
disable 1ubq       # hide the 1ubq object
disable (chain A)  # disable every object containing chain A atoms
```

## Related
- [enable](./enable.md)
- [show](../commands/show.md)
- [hide](../commands/hide.md)

## Source
`packages/engine/modules/pymol/viewing.py:428`. Parity: implemented (object enable/disable visibility, feature-parity row 114).
