---
name: fnab
kind: command
category: editing-building
subcategory: nucleic builder
summary: Builds a nucleic-acid object from a one-letter sequence as DNA or RNA, in A or B form, optionally as a double helix.
parity: implemented
---

## Purpose
`fnab` ("fetch nucleic acid builder") constructs a 3D nucleic acid from a one-letter sequence, using fragment geometry from the 3DNA package. It is the DNA/RNA analogue of [fab](fab.md).

## Syntax
`fnab(input, name=None, mode='DNA', form='B', dbl_helix=1)`

| Param | Type | Default | Meaning |
| --- | --- | --- | --- |
| `input` | str | | sequence as one-letter codes |
| `name` | str | `None` | object name to create (default: `obj`) |
| `mode` | str | `'DNA'` | `DNA` or `RNA` |
| `form` | str | `'B'` | `A` or `B` helix form |
| `dbl_helix` | 0/1 | `1` | build as a double helix (DNA only) |

## Behaviour
If `name` is None a fresh name (`obj`) is generated; an existing name is uniquified via `get_unused_name`. `mode` is upper-cased and must be `DNA` or `RNA` (else `CmdException`). Double-helix RNA is not supported: when `mode=RNA` and `dbl_helix` is set, it prints a warning and forces `dbl_helix=0`. Each input letter is validated against the base table for the chosen mode before building; an unrecognized code raises `CmdException`. Fragments are provided by Lu & Olson, 3DNA (Nucleic Acids Research 32, W667-W675, 2004).

## Examples
```python
fnab ATGCGATAC
fnab ATGCGATAC, name=myDNA, mode=DNA, form=B, dbl_helix=1
fnab AAUUUUCCG, mode=RNA
```

## Related
- [fab](fab.md) - peptide builder
- [fragment](fragment.md) - single fragment retrieval

## Source
`packages/engine/modules/pymol/editor.py` (`def fnab`). Parity: implemented in `packages/engine-ts/src/cmd/nucleic.ts:165`.
