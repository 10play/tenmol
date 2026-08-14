---
name: load_model
kind: command
category: file-io
subcategory: chempy import
summary: Load an in-memory ChemPy model object into PyMOL as a molecular object.
parity: partial
---

## Purpose
`load_model` reads a ChemPy `model` (a Python object holding atoms, bonds and
coordinates) into a named PyMOL object. Use it when you have constructed or received
a molecule programmatically via the ChemPy API rather than from a file on disk.

## Syntax
`load_model(model, object[, state[, finish[, discrete]]])`

It prepends `loadable.model` and delegates to [load_object](load_object.md).

| Param | Type | Default | Meaning |
| --- | --- | --- | --- |
| `model` | chempy.model | — | the model object to load |
| `object` | str | — | destination object name |
| `state` | int | 0 | target state, 0 to append |
| `finish` | int | 1 | perform (1) or defer (0) post-processing |
| `discrete` | int | 0 | treat states as unrelated atom sets |

## Behaviour
The call becomes `load_object(loadable.model, model, object, ...)`, so all
state/finish/discrete/zoom handling is that of `load_object` (type code 8). Higher
level readers such as `load_mmtf` build a ChemPy model and then call `load_model`
internally. For file-based loading use `load`.

## Examples
```python
from chempy.models import Indexed
m = Indexed()
# ... populate m.atom / m.bond ...
cmd.load_model(m, "built")
```

## Related
- [load_object](load_object.md) — the generic loader it delegates to
- [load_cgo](load_cgo.md) — sibling loader for CGO geometry

## Source
`packages/engine/modules/pymol/importing.py:327` (`def load_model`). Registered as a
no-op stub in the TS port (`packages/engine-ts/src/cmd/extras.ts`).
