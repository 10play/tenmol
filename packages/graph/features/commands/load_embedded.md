---
name: load_embedded
kind: command
category: file-io
subcategory: embedded data
summary: Load structure/data blocks that were embedded inline in the current script with the "embed" command.
parity: partial
---

## Purpose
`load_embedded` materialises a data block that was declared earlier in the running
PyMOL script using the `embed` command, turning inline text (e.g. a small PDB) into
a real object. It lets a single `.pml`/`.py` script carry its own structures with no
external files.

## Syntax
`load_embedded(key=None, name=None, state=0, finish=1, discrete=1, quiet=1, zoom=-1, multiplex=-2, object_props=None, atom_props=None)`

| Param | Type | Default | Meaning |
| --- | --- | --- | --- |
| `key` | str | None | name of the embedded block; defaults to the parser's current default key |
| `name` | str | None | destination object name; defaults to `key` |
| `state` | int | 0 | target state, 0 to append |
| `finish` | int | 1 | perform (1) or defer (0) post-processing |
| `discrete` | int | 1 | treat states as unrelated atom sets |
| `quiet` | int | 1 | suppress chatter |
| `zoom` | int | -1 | auto-zoom behaviour |
| `multiplex` | int | -2 | split multi-model files into separate objects |
| `object_props` | — | None | object property spec |
| `atom_props` | — | None | atom property spec |

## Behaviour
The block is fetched from the parser via `get_embedded(key)`; if it is not found an
error is printed and `DEFAULT_ERROR` is returned. When `name` is omitted it falls
back to `key` (or the parser's default key). The retrieved `[format, lines]` pair is
concatenated and handed to [load_raw](load_raw.md), so the block's declared format
drives parsing. Works with text data only. The `embed ... embed end` block must
appear before the `load_embedded` call in the same script.

## Examples
```text
embed wats, pdb
HETATM    1  O   WAT     1       2.573  -1.034  -1.721
HETATM    2  H1  WAT     1       2.493  -1.949  -1.992
embed end

load_embedded wats
```

## Related
- [load_raw](load_raw.md) — the memory loader this delegates to
- [loadall](loadall.md) — glob-load many files at once

## Source
`packages/engine/modules/pymol/importing.py:856` (`def load_embedded`). Registered
as a no-op stub in the TS port (`packages/engine-ts/src/cmd/extras.ts`, needs a
script parser / filesystem it lacks).
