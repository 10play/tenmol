---
name: fragment
kind: command
category: editing-building
subcategory: fragment library
summary: Retrieves a 3D structure from the built-in fragment library (currently mostly amino acids).
parity: unknown
---

## Purpose
`fragment` loads a small pre-built 3D structure from PyMOL's fragment library by name. The library is fairly meager - essentially the amino acids - and is used as a building block for editing/building workflows.

## Syntax
`fragment(name, object=None, origin=1, zoom=0, quiet=1)`

| Param | Type | Default | Meaning |
| --- | --- | --- | --- |
| `name` | str | | fragment name to retrieve (e.g. `ala`) |
| `object` | str | `None` | object name to load into (default: derived from name) |
| `origin` | int | `1` | move the fragment to the origin |
| `zoom` | int | `0` | zoom to the fragment after loading |
| `quiet` | int | `1` | suppress feedback |

## Behaviour
The fragment is read from the library and placed as a new (or named) object. With `origin=1` it is centered at the rotation origin; with `zoom=1` the view zooms to it. Useful as a seed for building larger structures via editing commands.

## Examples
```python
fragment ala
fragment gly, object=myres, zoom=1
```

## Related
- [fab](fab.md), [fnab](fnab.md) - sequence builders
- [get_fragment_names]() - available fragment names

## Source
`packages/engine/modules/pymol/creating.py` (`def fragment`). Parity: not registered as an engine-ts command.
