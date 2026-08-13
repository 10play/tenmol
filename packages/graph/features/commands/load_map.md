---
name: load_map
kind: command
category: maps-volumes
subcategory: map import
summary: Developer helper that loads a ChemPy map object into PyMOL (temporary routine for the Phenix project).
parity: unknown
---

## Purpose
`load_map` is a developer convenience that loads an in-memory ChemPy map object as a
PyMOL map object. It exists as a "temporary routine for the Phenix project" and is
rarely used directly in normal workflows.

## Syntax
`load_map(object, name, state, finish, discrete)`

It prepends the `loadable.chempymap` type code and forwards to
[load_object](load_object.md), so its arguments are those of `load_object` with the
map object supplied as the first data argument.

## Behaviour
The function simply builds `[loadable.chempymap, *args]` and calls `load_object`,
which passes the object through the C loader with the ChemPy-map type (11). State,
finish, discrete and zoom semantics are inherited from `load_object`. For loading map
files from disk, use `load` instead; `load_map` is specifically for pre-built ChemPy
map objects in memory.

## Examples
```python
# `m` is a chempy.map object produced by an external tool
cmd.load_map(m, "density")
```

## Related
- [load_object](load_object.md) — the generic loader it delegates to
- [load_mtz](load_mtz.md) — reflection-file map import

## Source
`packages/engine/modules/pymol/importing.py:218` (`def load_map`). Not present in
`packages/engine-ts/src`.
