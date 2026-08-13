---
name: show
kind: command
category: representations-display
subcategory: representations
summary: Turns on a representation for the atoms/objects in a selection (additive; leaves other representations intact).
parity: implemented
---

## Purpose
`show` enables a visual representation (lines, sticks, cartoon, surface, etc.) for the specified selection or object. It is additive: existing representations stay on. It is the everyday command for building up how a structure is drawn; use `hide` to turn things off and `as` (`show_as`) to switch exclusively.

## Syntax
`show(representation='wire', selection='')`

| Param | Type | Default | Meaning |
| --- | --- | --- | --- |
| `representation` | string | `'wire'` | One of: lines, spheres, mesh, ribbon, cartoon, sticks, dots, surface, labels, extent, nonbonded, nb_spheres, slice, dashes, angles, dihedrals, cgo, cell, callback, or everything |
| `selection` | string | `''` | Selection-expression or name-pattern to affect |

## Behaviour
Delegates to `_showhide(representation, selection, 1, ...)` — the `1` flag means "show". With no arguments, `show` alone turns on lines for all bonds and nonbonded for all atoms in every molecular object. The default `representation` value is reported as `wire` (an alias of lines). An empty `selection` targets everything.

## Examples
```python
show
show ribbon
show lines, (name CA+C+N)
```

## Related
- [hide](./hide.md)
- [show_as](./show_as.md)
- [enable](./enable.md)
- [disable](./disable.md)

## Source
`packages/engine/modules/pymol/viewing.py:520`; signature in `docs/api-reference/commands.mdx:3772`. Parity: implemented in `packages/engine-ts/src/cmd/display.ts` / executive.
