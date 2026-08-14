---
name: get_pdbstr
kind: command
category: file-io
subcategory: pdb export
summary: Return a PDB-format string for the atoms in a selection at a given state.
parity: implemented
---

## Purpose
`get_pdbstr` is an API-only function that serialises a selection to a PDB-format
string in memory (no file written). Reach for it when a script needs PDB text to
pass to another tool or embed in a request without touching disk.

## Syntax
`get_pdbstr(selection='all', state=-1, ref='', ref_state=-1, quiet=1)`

| Param | Type | Default | Meaning |
| --- | --- | --- | --- |
| `selection` | str | `'all'` | Atoms to export |
| `state` | int | `-1` | 1-based state; `-1` = current state, `0` = all states |
| `ref` | str | `''` | Reference object to align coordinates against |
| `ref_state` | int | `-1` | State of the reference object |
| `quiet` | int | `1` | Suppress console output |

## Behaviour
Thin wrapper over `get_str('pdb', ...)`. `state` follows PyMOL convention: `-1`
uses the current state, `0` writes all states, and any positive value is a
1-based state index. When `ref`/`ref_state` are supplied, coordinates are
expressed relative to that reference frame. Returns the PDB text as a string.

## Examples
```python
pdb = cmd.get_pdbstr("chain A")
pdb_all = cmd.get_pdbstr("myprot", state=0)
```

## Related
- [get_fastastr](get_fastastr.md), [get_session](get_session.md), [save](save.md)

## Source
`packages/engine/modules/pymol/exporting.py:222`. Parity: implemented — registered
at `packages/engine-ts/src/cmd/fileio.ts:328`.
