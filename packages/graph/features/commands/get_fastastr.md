---
name: get_fastastr
kind: command
category: file-io
subcategory: sequence export
summary: Returns protein and nucleic-acid sequences for a selection in FASTA format.
parity: implemented
---

## Purpose
`get_fastastr` is an API-only function that returns a FASTA-format string of the polymer sequences in a selection. It backs `save foo.fasta` and is used to extract sequences programmatically. New in PyMOL 2.2 it added chain-specific keys and nucleic-acid support.

## Syntax
`get_fastastr(selection='all', state=-1, quiet=1, key='')`

| Param | Type | Default | Meaning |
| --- | --- | --- | --- |
| `selection` | str | `'all'` | Atom selection (reduced to `guide & alt +A`) |
| `state` | int | `-1` | Only used if `state > 0` (filters to that state) |
| `quiet` | 0/1 | `1` | UNUSED |
| `key` | str | `''` | Python expression for the FASTA record key; default `model + "_" + chain` |

## Behaviour
The selection is narrowed to `(selection) & guide & alt +A`; if `state > 0` it appends `& state N`. Records are grouped by evaluating `key` per atom (default gives one record per model+chain; use `key=model` for the old non-chain-specific behaviour, and for discrete objects the default appends `:state`). Residue names are mapped to one-letter codes via `_resn_to_aa` (unknowns become `?`), then wrapped at 70 columns. Returns the joined string with a trailing newline; empty selections return an empty string. `quiet` is ignored.

## Examples
```python
print(cmd.get_fastastr("chain A"))
save seq.fasta, polymer
open("out.fa","w").write(cmd.get_fastastr("1abc", key="model"))
```

## Related
- [get_pdbstr](../commands/get_pdbstr.md)
- [save](../commands/save.md)

## Source
`packages/engine/modules/pymol/exporting.py:170`. Parity: implemented in `packages/engine-ts/src/cmd/fileio.ts`. Note: not a substitute for a full sequence-viewer model (no colors/atom indices/gaps).
