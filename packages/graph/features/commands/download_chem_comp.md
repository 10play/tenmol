---
name: download_chem_comp
kind: command
category: file-io
subcategory: ligand fetch
summary: Internal routine that downloads the RCSB chemical-component CIF for a residue name and returns its local path.
parity: internal
---

## Purpose
`download_chem_comp` fetches the idealized chemical-component dictionary (CIF) for a given residue/ligand code from RCSB and caches it under the `fetch_path` directory. It underpins ligand-building helpers (e.g. `get_chem_comp` / fragment building); the docstring warns it is an internal routine subject to change.

## Syntax
`download_chem_comp(resn, quiet=1)`

| Param | Type | Default | Meaning |
| --- | --- | --- | --- |
| `resn` | str | — | Three-letter (or PDB) chemical-component id |
| `quiet` | 0/1 | `1` | Suppress the "Downloading…" / path messages |

## Behaviour
Builds `<fetch_path>/<resn>.cif` and returns it immediately if it already exists (local cache). Otherwise it reads `https://files.rcsb.org/ligands/download/<resn>.cif` via `cmd.file_read`; on empty content or an exception it prints `Error: Download failed` and returns `''`. The downloaded bytes are written to the cache path; an `IOError` (e.g. read-only `fetch_path`) is reported and also returns `''`. On success returns the local filename.

## Examples
```python
path = cmd.download_chem_comp("ATP")   # -> '<fetch_path>/ATP.cif' or ''
```

## Related
- [fetch](../commands/fetch.md)
- [load](../commands/load.md)

## Source
`packages/engine/modules/pymol/internal.py:311` (marked "internal routine, subject to change"). Parity: not ported in the TypeScript engine slice.
