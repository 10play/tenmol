---
name: uniquify
kind: command
category: editing-building
subcategory: atom identifiers
summary: Renames an atom identifier (chain, segi, etc.) so its values are unique relative to a reference selection.
parity: implemented
---

## Purpose
`uniquify` rewrites a chosen atom identifier (chain, segi, resi, …) in one selection so that none of its values collide with those in a reference selection. It is the tool for resolving naming conflicts — e.g. giving a second copy of a structure fresh chain IDs before merging.

## Syntax
`uniquify(identifier, selection, reference='', quiet=1)`

| Param | Type | Default | Meaning |
| --- | --- | --- | --- |
| `identifier` | str | — | atom identifier to modify (chain, segi, resi, …) |
| `selection` | str | — | atom selection to modify |
| `reference` | str | `''` | selection whose identifiers must not be reused; defaults to `!(selection)` |
| `quiet` | int | `1` | suppress the rename count message |

## Behaviour
It gathers the identifier values present in the reference and in the target via `iterate`, intersects them, and for each colliding value picks the next unused name and `alter`s the selection to it. New names are drawn differently by type: integer identifiers count up from 1; `resi` uses string integers; other identifiers (chain/segi) use a base-N sequence over `A–Z1–9`. If there is no overlap it returns immediately without changes. When `reference` is empty it defaults to everything outside the selection, `!(selection)`.

## Examples
```python
fetch 1a00 1hbb, async=0
uniquify chain, 1hbb
# 1hbb now has chains E,F,G,H (disjoint from 1a00's A,B,C,D)
```

## Related
- [alter](../commands/alter.md)
- [copy_to](../commands/copy_to.md)

## Source
`packages/engine/modules/pymol/editing.py:3052`. Parity: implemented in `packages/engine-ts/src/cmd/editing.ts`.
