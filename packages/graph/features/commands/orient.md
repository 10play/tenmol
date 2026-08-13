---
name: orient
kind: command
category: viewing-camera
subcategory: camera framing
summary: Aligns the principal axes of a selection with the screen XYZ axes.
parity: implemented
---

## Purpose
`orient` computes the principal components (inertia axes) of the selected atoms
and rotates the camera so the longest axis lies horizontal and the molecule
fills the view in its most informative orientation. It is the standard way to
get a clean "best view" of an object before rendering.

## Syntax
```
orient(selection='(all)', state=0, animate=0)
```

| Param | Type | Default | Meaning |
| --- | --- | --- | --- |
| `selection` | str | `'(all)'` | selection-expression or name pattern to orient |
| `state` | int | `0` | 0 = use all states; -1 = current state; >0 = a specific state |
| `animate` | float | `0` | seconds of smooth camera animation into the new view |

## Behaviour
The selection is preprocessed and passed to `_cmd.orient` with a 0-based state.
With the default `state=0` all coordinate states contribute to the principal-
component analysis; `state=-1` uses only the current state. The method mirrors
X-PLOR's orient. A positive `animate` interpolates the camera over that many
seconds rather than snapping. Only the camera moves — atom coordinates are
unchanged.

## Examples
```
orient
orient organic
orient chain A, animate=2
```

## Related
- `zoom`, [origin](origin.md), `reset` - related camera framing commands

## Source
`packages/engine/modules/pymol/viewing.py:310`. Camera-command parity tracked in
`docs/feature-parity.md:353`.
