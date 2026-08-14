---
name: load_cgo
kind: command
category: cgo
subcategory: cgo import
summary: Load a Compiled Graphics Object (a flat list of floats built from cgo.py constants) as a named object.
parity: unknown
---

## Purpose
`load_cgo` imports a Compiled Graphics Object (CGO) — a flat list of floating
point numbers assembled from the opcode constants in
`$PYMOL_PATH/modules/pymol/cgo.py` — into a named PyMOL object. Reach for it when
you have built custom geometry (lines, triangles, spheres, cylinders) as raw CGO
data and want to display it.

## Syntax
`load_cgo(object, name, state, finish, discrete)`

It is a thin wrapper that prepends the `loadable.cgo` type code and delegates to
[load_object](load_object.md).

| Param | Type | Default | Meaning |
| --- | --- | --- | --- |
| `object` | list | — | the CGO float list (coerced to a list if not already one) |
| `name` | str | — | destination object name |
| `state` | int | 0 | object state; 0 appends after the last state |
| `finish` | int | 1 | perform (1) or defer (0) post-processing |
| `discrete` | int | 0 | treat states as unrelated atom sets |

## Behaviour
The first positional argument (the CGO data) is normalised to a Python list if it
is any other sequence type, then the call is forwarded to `load_object` with the
numeric type `loadable.cgo` (13). All state/finish/discrete semantics are those of
`load_object`. This is the public import side of the CGO round trip; the export
side is `CGOAsPyList`/session save.

## Examples
```python
from pymol.cgo import *
obj = [ BEGIN, LINES, VERTEX, 0.,0.,0., VERTEX, 1.,0.,0., END ]
cmd.load_cgo(obj, "axis")
```

## Related
- [load_object](load_object.md) — the generic loader this delegates to
- [load_model](load_model.md) — sibling loader for ChemPy models

## Source
`packages/engine/modules/pymol/importing.py:308` (`def load_cgo`). CGO round-trip
parity tracked in `docs/feature-parity.md` (CGOAsPyList/CGONewFromPyList). Not
present in `packages/engine-ts/src`.
