---
name: translate_atom
kind: command
category: editing-building
subcategory: coordinate translation
summary: Shifts the coordinates of the atoms matched by a selection by an explicit x/y/z vector.
parity: implemented
---

## Purpose
`translate_atom` moves the atoms matched by a selection by a per-component
translation vector. It is a low-level editing primitive used when building or
adjusting structures programmatically.

## Syntax
`translate_atom(sele1, v0, v1, v2, state=0, mode=0, log=0)`

| Param | Type | Default | Meaning |
| --- | --- | --- | --- |
| `sele1` | string | — | Selection of atoms to move. |
| `v0` | float | — | X component of the translation. |
| `v1` | float | — | Y component of the translation. |
| `v2` | float | — | Z component of the translation. |
| `state` | int | `0` | Object state (1-based at API; `0` = all/current). |
| `mode` | int | `0` | Translation mode passed through to the core. |
| `log` | 0/1 | `0` | Write the action to the log file. |

## Behaviour
The selection is preprocessed and the three components are cast to floats before
dispatch to `_cmd.translate_atom`; `state` is decremented internally. Unlike
[translate](../commands/translate.md), the vector components are passed
separately and there is no camera-coordinate interpretation — the shift is applied
directly in model space.

## Examples
```python
cmd.translate_atom("pk1", 0.5, 0.0, -0.5)
```

## Related
- [translate](../commands/translate.md)
- [transform_selection](../commands/transform_selection.md)

## Source
`packages/engine/modules/pymol/editing.py:2507`. Parity: implemented — registered
in `packages/engine-ts/src/cmd/editing.ts:460`.
