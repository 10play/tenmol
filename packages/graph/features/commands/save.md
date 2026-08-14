---
name: save
kind: command
category: file-io
subcategory: export
summary: Writes molecular data, sessions, images, or geometry to a file, choosing the format from the extension.
parity: planned
---

## Purpose
`save` is PyMOL's universal writer: it serialises a selection (or the whole session, an image, etc.) to a file whose format is inferred from the filename extension. Reach for it to export coordinates (PDB, mmCIF, MOL2, SDF), save a session (PSE), or write out other supported artifacts.

## Syntax
`save(filename, selection='(all)', state=-1, format='', ref='', ref_state=-1, quiet=1, partial=0)`

| Param | Type | Default | Meaning |
| --- | --- | --- | --- |
| `filename` | string | — | output file path |
| `selection` | string | `'(all)'` | atoms to save |
| `state` | int | `-1` | state to save (`-1` current, `0` multi-state) |
| `format` | string | `''` | force a format instead of inferring from extension |
| `ref` | string | `''` | reference object to align output coordinates to |
| `ref_state` | int | `-1` | state of the reference object |
| `quiet` | int | `1` | suppress console feedback |
| `partial` | int | `0` | allow partial/atom-subset export where supported |

## Behaviour
The format is chosen from the extension when one of the supported types is recognised: pdb, pqr, mol, sdf, pkl, pkla, mmd, out, dat, mmod, cif, pov, png, pse, psw, aln, fasta, obj, mtl, wrl, dae, idtf, or mol2; an unrecognised extension defaults to PDB. For molecular formats, `state=-1` writes only the current state while `state=0` writes a multi-state file. Session formats (`pse`/`psw`) also set the `session_file` setting. If neither the extension nor `format` yields a known format, a `CmdException` ("Unrecognized file format") is raised.

## Examples
```python
save out.pdb, polymer
save complex.pse
save all_states.sdf, ligand, state=0
```

## Related
- [load](../commands/load.md)
- [get_model](../commands/get_model.md)

## Source
`packages/engine/modules/pymol/exporting.py:784`; signature in `docs/api-reference/commands.mdx:3358`. Parity: registered as a no-op stub in `packages/engine-ts/src/cmd/extras.ts` (no filesystem in this environment); planned.
