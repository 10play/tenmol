---
name: get_str
kind: command
category: file-io
subcategory: in-memory export
summary: Export a selection to a molecular file format and return it as a unicode string.
parity: implemented
---

## Purpose
`get_str` serialises a selection into a text molecular format (PDB, CIF, SDF,
MOL, MOL2, MAE, PQR, XYZ, …) and returns the result as a unicode `str` rather
than writing to disk. It is the text sibling of `get_bytes`; use it when you want
the file content in memory, e.g. to hand to another library or a web response.

## Syntax
`get_str(format, selection='(all)', state=-1, ref='', ref_state=-1, multi=-1, quiet=1)`

| Param | Type | Default | Meaning |
| --- | --- | --- | --- |
| `format` | str | — | Target format: `pdb`, `cif`, `sdf`, `mol`, `mol2`, `mae`, `pqr`, `xyz`, … |
| `selection` | str | `'(all)'` | Atom selection to export |
| `state` | int | `-1` | Object state (`-1` = current, `0` = all) |
| `ref` | str | `''` | Object whose frame defines the reference coordinate system |
| `ref_state` | int | `-1` | State of `ref` |
| `multi` | int | `-1` | Multi-entry packing: `0` = single, `1` = by object, `2` = by object-state, `-1` = format default |
| `quiet` | int | `1` | Suppress feedback |

## Behaviour
Delegates to `get_bytes` with the same arguments and decodes the result as
UTF-8, returning `None` if `get_bytes` returned `None`. Binary formats are
rejected: an `assert` blocks `format='mmtf'` (use `get_bytes` for those). `state`
is forwarded to the engine as `state - 1`.

## Examples
```python
pdb_text = cmd.get_str("pdb", "chain A")
cif_text = cmd.get_str("cif", "polymer", state=0)
```

## Related
- [get_bytes](get_bytes.md), [save](save.md), [multisave](multisave.md)

## Source
`packages/engine/modules/pymol/exporting.py:666`. Parity: implemented — present
in `packages/engine-ts/src/cmd/exporters.ts`.
