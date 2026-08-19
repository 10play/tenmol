---
name: set_raw_alignment
kind: command
category: fitting-alignment
subcategory: alignment objects
summary: API-only builder that constructs an alignment object from raw lists of (model, index) column tuples.
parity: implemented
---

## Purpose
`set_raw_alignment` is the inverse of `get_raw_alignment`: it creates a named alignment object directly from a list of columns, each column being a list of `(model, index)` tuples that identify aligned atoms. Use it to reconstruct or synthesize alignments programmatically without running a structural aligner.

## Syntax
`set_raw_alignment(name, raw, guide='', state=1, quiet=1)`

| Param | Type | Default | Meaning |
| --- | --- | --- | --- |
| `name` | str | — | Alignment object name |
| `raw` | list | — | List (columns) of lists of `(model, index)` tuples |
| `guide` | str | `''` | Name of the guide object |
| `state` | int | `1` | Object state |
| `quiet` | int | `1` | Suppress feedback |

## Behaviour
API-only (no command-line typing form). The wrapper decrements `state` to a 0-based index before dispatch. Each column groups atoms that are mutually aligned across the participating models; `index` refers to a 1-based atom index within `model`. The optional `guide` names the reference object for the alignment.

## Examples
```python
cmd.align('1t46', '1oky', object='aln')
raw = cmd.get_raw_alignment('aln')
cmd.delete('aln')
cmd.set_raw_alignment('alnnew', raw)
```

## Related
- [get_raw_alignment](./get_raw_alignment.md)
- [align](./align.md)

## Source
`packages/engine/modules/pymol/creating.py:648`; signature in `docs/api-reference/commands.mdx:3672`. Parity: ported in `packages/engine-ts/src/cmd/align.ts` (`ctx.command('set_raw_alignment', …)`) — normalises the raw columns into the same store `get_raw_alignment` reads. NOTE: it cannot be differentially verified because the real-PyMOL oracle's `_cmd.set_raw_alignment` segfaults on every input (see `packages/graph/verify/reports/command__set_raw_alignment.md`).
