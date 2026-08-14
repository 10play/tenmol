---
name: symexp
kind: command
category: symmetry
subcategory: crystallographic expansion
summary: Creates all symmetry-related copies of an object that fall within a cutoff distance of an atom selection.
parity: implemented
---

## Purpose
`symexp` generates the crystallographic neighbours of an object by applying the
space-group symmetry operators and unit-cell translations, keeping only those
mates that come within a cutoff of a chosen selection. Use it to build the
crystal-packing environment around a molecule.

## Syntax
`symexp(prefix, object, selection, cutoff, segi=0, quiet=1)`

| Param | Type | Default | Meaning |
| --- | --- | --- | --- |
| `prefix` | string | — | Name prefix for the generated symmetry-mate objects. |
| `object` | string | — | Source object carrying the cell + space group. |
| `selection` | string | — | Selection about which the cutoff is measured. |
| `cutoff` | float | — | Distance (Å) within which a symmetry mate must approach the selection to be kept. |
| `segi` | int | `0` | If set, tag each mate with a distinct segment identifier. |
| `quiet` | int | `1` | Suppress feedback when set. |

## Behaviour
The selection is preprocessed and wrapped in parentheses before dispatch. The
newly created objects are named with the given prefix plus their symmetry
operation and translation, so each mate is individually identifiable. The source
object must carry valid crystal symmetry (cell + space group) for expansion to
succeed. Larger cutoffs generate more mates.

## Examples
```
symexp sym, 1abc, (1abc), 5.0
symexp mate_, xtal, (chain A), 4, segi=1
```

## Related
- [symmetry_copy](../commands/symmetry_copy.md)
- [load](../commands/load.md)

## Source
`packages/engine/modules/pymol/creating.py:909`. Parity: implemented — registered
in `packages/engine-ts/src/cmd/symmetry.ts:200`.
