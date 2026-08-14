---
name: get_gltf
kind: command
category: rendering-export
subcategory: 3d export
summary: Exports the current display to a glTF file via an external collada2gltf converter.
parity: unknown
---

## Purpose
`get_gltf` saves a glTF file representing the currently displayed scene, for use in external 3D/AR/web viewers. It works by exporting COLLADA and converting it with the `collada2gltf` binary.

## Syntax
`get_gltf(filename, quiet=1)`

| Param | Type | Default | Meaning |
| --- | --- | --- | --- |
| `filename` | str | (required) | Output path; also used as the intermediate COLLADA file |
| `quiet` | 0/1 | `1` | If `0`, prints a save/error message |

## Behaviour
Locates `collada2gltf` (or `COLLADA2GLTF-bin`) on `PATH`; raises `CmdException('could not find collada2gltf')` if absent. It sets `collada_geometry_mode=1`, generates COLLADA via `get_collada`, writes it to `filename`, then shells out to the converter with `-i filename -o filename`, overwriting in place. Returns the subprocess exit code (0 = success). Requires the external binary to be installed.

## Examples
```python
cmd.get_gltf("scene.gltf")
cmd.get_gltf("scene.gltf", quiet=0)
```

## Related
- [get_collada](../commands/get_collada.md)
- [get_vrml](../commands/get_vrml.md)
- [get_idtf](./get_idtf.md)

## Source
`packages/engine/modules/pymol/querying.py:664`. Parity: no TypeScript port found (depends on external `collada2gltf`); parityStatus unknown.
