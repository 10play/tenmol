---
name: get_raw_alignment
kind: command
category: fitting-alignment
subcategory: alignment introspection
summary: Return the raw per-atom alignment relationships of an alignment object as lists of (object, index) tuples.
parity: partial
---

## Purpose
`get_raw_alignment` exposes the atom-to-atom correspondences stored in an
alignment object as raw data. Use it to inspect exactly which atoms of which
objects were paired by `align`, `super`, `cealign`, etc.

## Syntax
`get_raw_alignment(name='', active_only=0)`

| Param | Type | Default | Meaning |
| --- | --- | --- | --- |
| `name` | str | `''` | Alignment object name; `''` = the current/only alignment |
| `active_only` | int | `0` | If true, restrict to currently enabled objects |

## Behaviour
Locks the API and calls the C-layer `get_raw_alignment`. Returns a list of
columns; each column is a list of `(object, index)` tuples naming the mutually
aligned atoms (index is 1-based). Every column represents one aligned position
across the participating objects.

## Examples
```python
cmd.align("mobile", "target", object="aln")
cols = cmd.get_raw_alignment("aln")
```

## Related
- [align](align.md), [super](super.md), [cealign](cealign.md)

## Source
`packages/engine/modules/pymol/querying.py:1487`. Parity: partial — registered at
`packages/engine-ts/src/cmd/align.ts:735` but returns an empty list stub.
