---
name: multisave
kind: command
category: file-io
subcategory: multi-entry export
summary: Writes a multi-entry PDB/CIF file, one HEADER/CRYST-delimited entry per object.
parity: implemented
---

## Purpose
`multisave` saves a selection as a multi-entry file where each object gets its
own HEADER, CRYST (when symmetry is defined) and terminating END record. Loading
such a file back into PyMOL recreates each entry as a separate object - unlike
`save`, which flattens a multi-object selection into one entry.

## Syntax
```
multisave(filename, pattern='all', state=-1, append=0, format='', quiet=1)
```

| Param | Type | Default | Meaning |
| --- | --- | --- | --- |
| `filename` | str | | file path to write |
| `pattern` | str | `'all'` | atom selection (before 1.8.4: object name pattern) |
| `state` | int | `-1` | object state (-1=current, 0=all) |
| `append` | int | `0` | append to an existing file instead of overwriting |
| `format` | str | `''` | file format (default: guess from extension, or `pdb`) |
| `quiet` | int | `1` | suppress feedback |

## Behaviour
Determines the format from `format` or the filename extension (falling back to
`pdb`); only `pdb` and `cif` are supported (`pmo` and zipped outputs raise
`CmdException`). It serializes the selection with `get_str(..., multi=1)` (one
entry per object) and writes it, opening the file in append mode when
`append=1`. Each object is emitted with its own HEADER/CRYST/END framing so the
entries reload as distinct objects.

## Examples
```
multisave ensemble.pdb, all
multisave models.cif, myobjs, state=0
multisave out.pdb, obj2, append=1
```

## Related
- [multifilesave](multifilesave.md) - one file per object/state instead
- `save`, `load` - flat export / import

## Source
`packages/engine/modules/pymol/exporting.py:604`. Registered in the TS port at
`packages/engine-ts/src/cmd/exporters.ts:553`.
