---
name: get_bytes
kind: command
category: file-io
subcategory: in-memory export
summary: Exports a selection to a molecular file format and returns it as a bytes string.
parity: implemented
---

## Purpose
`get_bytes` is an API-only function that serializes a selection to a molecular file format and returns the result as a binary (`bytes`) string, without writing to disk. Reach for it to marshal structures over the network or into memory buffers.

## Syntax
`get_bytes(format, selection='(all)', state=-1, ref='', ref_state=-1, multi=-1, quiet=1)`

| Param | Type | Default | Meaning |
| --- | --- | --- | --- |
| `format` | str | — | One of `pdb`, `cif`, `sdf`, `mol`, `mol2`, `mae`, `pqr`, `xyz` |
| `selection` | str | `'(all)'` | Atom selection |
| `state` | int | `-1` | Object state; `-1` = current, `0` = all |
| `ref` | str | `''` | Object name defining the reference frame |
| `ref_state` | int | `-1` | State of the `ref` object |
| `multi` | int | `-1` | Multi-entry mode: `0` single entry, `1` by object, `2` by object-state, `-1` format default |
| `quiet` | 0/1 | `1` | Verbosity |

## Behaviour
Dispatches to `_cmd.get_str` with a zero-based `state-1`, returning raw bytes rather than text (the binary counterpart to the various `get_*str` helpers). `ref`/`ref_state` let you emit coordinates in another object's reference frame. `multi` controls how objects/states are packed for multi-entry formats such as SDF or MAE.

## Examples
```python
data = cmd.get_bytes("pdb", "polymer")
maebytes = cmd.get_bytes("mae", "all", state=0, multi=2)
```

## Related
- [get_cifstr](../commands/get_cifstr.md)
- [get_pdbstr](../commands/get_pdbstr.md)
- [save](../commands/save.md)

## Source
Upstream `packages/engine/modules/pymol/exporting.py:679`. Parity: implemented — registered as `ctx.command('get_bytes')` in `packages/engine-ts/src/cmd/exporters.ts:503`.
