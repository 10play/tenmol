---
name: show_as
kind: command
category: representations-display
subcategory: representations
summary: Exclusively shows one representation for a selection, hiding all others on those atoms (the "as" command).
parity: implemented
---

## Purpose
`show_as` (typed as `as` on the command line) switches a selection to a single representation, turning on the requested one and hiding everything else on those atoms. Reach for it when you want a clean replacement rather than the additive behaviour of `show`.

## Syntax
`show_as(representation='wire', selection='')`

| Param | Type | Default | Meaning |
| --- | --- | --- | --- |
| `representation` | string | `'wire'` | One of: lines, spheres, mesh, ribbon, cartoon, sticks, dots, surface, labels, extent, nonbonded, nb_spheres, slice, dashes, angles, dihedrals, cgo, cell, callback, volume, or everything |
| `selection` | string | `''` | Selection-expression or object name; default is all |

## Behaviour
Delegates to `_showhide(representation, selection, 2, ...)` — the `2` flag means "show exclusively". `as` alone turns on lines and nonbonded and hides everything else. `selection` may be an object name. Unlike `show`, any previously visible representation on the affected atoms is turned off.

## Examples
```python
as lines, name CA+C+N
as ribbon
as cartoon, polymer
```

## Related
- [show](./show.md)
- [hide](./hide.md)
- [enable](./enable.md)
- [disable](./disable.md)

## Source
`packages/engine/modules/pymol/viewing.py:557`; signature in `docs/api-reference/commands.mdx:3783`. Parity: implemented in `packages/engine-ts/src/exec/executive.ts`.
