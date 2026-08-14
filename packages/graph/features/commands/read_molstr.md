---
name: read_molstr
kind: command
category: file-io
subcategory: in-memory load
summary: Load an MDL MOL format structure from an in-memory Python string.
parity: implemented
---

## Purpose
`read_molstr` loads an MDL MOL (`.mol`) structure directly from a Python string,
bypassing temp files. Use it from API/bridge code to push a single-molecule MOL
block straight into PyMOL.

## Syntax
`read_molstr(molstr, name, state=0, finish=1, discrete=1, quiet=1, zoom=-1)`

| Param | Type | Default | Meaning |
| --- | --- | --- | --- |
| `molstr` | string | | the MOL block text |
| `name` | string | | object name to create/append into |
| `state` | integer | `0` | 1-based state index, or 0 to append |
| `finish` | 0/1 | `1` | finish the object now; 0 defers (call `finish_object`) |
| `discrete` | 0/1 | `1` | no overlapping atoms; saves memory but not editable |
| `quiet` | | `1` | suppress feedback |
| `zoom` | | `-1` | auto-zoom behaviour (-1 = use setting) |

## Behaviour
Forwards to `_cmd.load` with `loadable.molstr`, converting `state` from 1-based to
0-based. Setting `finish=0` speeds up bulk loading but requires a later
`finish_object` call. `discrete=1` (the default here) stores the object compactly
at the cost of editability. `multiplex` is fixed at 0 for this loader.

## Examples
```
cmd.read_molstr(mol_block_text, 'ligand')
```

## Related
- [read_sdfstr](../commands/read_sdfstr.md)
- [read_pdbstr](../commands/read_pdbstr.md)

## Source
`packages/engine/modules/pymol/importing.py:965` (`def read_molstr`). Parity:
implemented in `packages/engine-ts/src/cmd/fileio.ts:367`.
