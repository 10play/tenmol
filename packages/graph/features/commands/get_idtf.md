---
name: get_idtf
kind: command
category: rendering-export
subcategory: 3d export
summary: Experimental exporter intended to return an IDTF file of objects and scenes.
parity: unknown
---

## Purpose
`get_idtf` is an under-development exporter that should eventually return an IDTF (Intermediate Data Text Format) file containing multiple objects and scenes, for downstream conversion (e.g. to U3D for 3D PDF). It is incomplete.

## Syntax
`get_idtf(quiet=1)`

| Param | Type | Default | Meaning |
| --- | --- | --- | --- |
| `quiet` | 0/1 | `1` | If `0`, prints 3D view parameters (`3Daac`, `3Droo`, `3Dcoo`) for embedding |

## Behaviour
Locks the command layer and returns `_cmd.get_idtf`. With `quiet=0` it also prints camera parameters derived from the `field_of_view` setting and the current view distance, useful for a 3D-PDF `\annotation3d` block. The docstring itself notes this is under development.

## Examples
```python
data = cmd.get_idtf()
cmd.get_idtf(quiet=0)
```

## Related
- [get_gltf](./get_gltf.md)
- [get_collada](../commands/get_collada.md)

## Source
`packages/engine/modules/pymol/querying.py:563`. Parity: no TypeScript port found; feature is incomplete upstream; parityStatus unknown.
