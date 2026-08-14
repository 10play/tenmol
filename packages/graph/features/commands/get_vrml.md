---
name: get_vrml
kind: command
category: rendering-export
subcategory: scene export
summary: Return a VRML2 string representing the currently displayed content.
parity: unknown
---

## Purpose
`get_vrml` serialises the current 3D scene to a VRML (Virtual Reality Modeling
Language) string for export to other 3D tools or web viewers. It is the in-memory
counterpart to saving a `.wrl` file.

## Syntax
`get_vrml(version=2)`

| Param | Type | Default | Meaning |
| --- | --- | --- | --- |
| `version` | int | `2` | VRML output version |

## Behaviour
Returns a VRML2 text string built from the geometry currently displayed (as
tessellated by the renderer). The sibling `get_collada` produces a COLLADA string
via the same mechanism.

## Examples
```python
wrl = cmd.get_vrml()
open("scene.wrl", "w").write(wrl)
```

## Related
- [get_collada](get_collada.md), [save](save.md)

## Source
`packages/engine/modules/pymol/querying.py:632`. Parity: unknown — no direct
`get_vrml` export found in `packages/engine-ts/src`.
