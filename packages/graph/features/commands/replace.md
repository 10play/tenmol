---
name: replace
kind: command
category: editing-building
subcategory: interactive editing
summary: Replaces the currently picked atom with a new atom of a given element, geometry, and valence.
parity: implemented
---

## Purpose
`replace` swaps the picked atom (`pk1`) for a new atom of the specified element, hybridisation geometry, and valence. It is a molecule-building tool used interactively to mutate one atom into another while keeping the local bonding framework.

## Syntax
`replace(element, geometry, valence, h_fill=1, name='', quiet=1)`

| Param | Type | Default | Meaning |
| --- | --- | --- | --- |
| `element` | string | — | chemical symbol of the new atom |
| `geometry` | int | — | coordination geometry (hybridisation) code |
| `valence` | int | — | valence of the new atom |
| `h_fill` | int | `1` | strip existing hydrogens before replacing and refill as needed |
| `name` | string | `''` | optional explicit atom name |
| `quiet` | int | `1` | suppress console feedback |

## Behaviour
Requires a picked atom: if no `pk1` selection exists the command prints an error and raises. When `h_fill` is set (default), hydrogens neighbouring `pk1` are first removed via [remove](../commands/remove.md) so valence can be re-satisfied cleanly. The upstream docstring flags this as immature functionality. `geometry` and `valence` are integer codes matching PyMOL's atom-building conventions.

## Examples
```python
# pick an atom first, then mutate it to nitrogen
replace N, 3, 3
# replace with carbon, keeping existing hydrogens
replace C, 4, 4, h_fill=0
```

## Related
- [remove](../commands/remove.md)
- [attach](../commands/attach.md)
- [fuse](../commands/fuse.md)
- [bond](../commands/bond.md)
- [unbond](../commands/unbond.md)

## Source
`packages/engine/modules/pymol/editing.py:1572`; signature in `docs/api-reference/commands.mdx:3236`. Parity: implemented in `packages/engine-ts/src/cmd/builder.ts:673`.
