---
name: get_mtl_obj
kind: command
category: rendering-export
subcategory: 3d export
summary: Returns a tuple of MTL and OBJ text for the current display (incomplete feature).
parity: implemented
---

## Purpose
`get_mtl_obj` returns a tuple of `.mtl` (material) and `.obj` (geometry) file contents representing the current display, intended for import into Maya. The upstream docstring flags this as an incomplete and unsupported feature.

## Syntax
`get_mtl_obj()`

Takes no positional arguments (only the internal `_self`).

## Behaviour
Locks the command layer and returns the result of `_cmd.get_mtl_obj`, a tuple of the MTL and OBJ input strings. Because the feature is incomplete upstream, output coverage of representations is partial.

## Examples
```python
mtl, obj = cmd.get_mtl_obj()
```

## Related
- [get_collada](../commands/get_collada.md)
- [get_vrml](../commands/get_vrml.md)

## Source
`packages/engine/modules/pymol/querying.py:585`. Parity: a stub/port exists in `packages/engine-ts/src/cmd/extras.ts`; upstream feature itself is incomplete.
