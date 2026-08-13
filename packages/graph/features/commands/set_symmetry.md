---
name: set_symmetry
kind: command
category: symmetry
subcategory: crystal parameters
summary: Defines or redefines the unit-cell dimensions and space group of a molecule or map object.
parity: implemented
---

## Purpose
`set_symmetry` writes crystallographic symmetry — the six unit-cell parameters and a space-group name — onto a molecular or map object. Use it to add missing CRYST1 information or to correct it, enabling symmetry-mate generation (`symexp`) and correct map handling.

## Syntax
`set_symmetry(selection, a, b, c, alpha, beta, gamma, spacegroup='P1', state=-1, quiet=1)`

| Param | Type | Default | Meaning |
| --- | --- | --- | --- |
| `selection` | str | — | Object name pattern to modify |
| `a` | float | — | Unit-cell length a (Å) |
| `b` | float | — | Unit-cell length b (Å) |
| `c` | float | — | Unit-cell length c (Å) |
| `alpha` | float | — | Unit-cell angle α (degrees) |
| `beta` | float | — | Unit-cell angle β (degrees) |
| `gamma` | float | — | Unit-cell angle γ (degrees) |
| `spacegroup` | str | `'P1'` | Space-group symbol |
| `state` | int | `-1` | Target state; -1 = current |
| `quiet` | int | `1` | Suppress feedback |

## Behaviour
Runs under a lock; `state` is decremented to 0-based, and all six cell values are cast to float before dispatch. The `selection` argument is treated as an object name pattern (not an atom selection), so symmetry is set object-wide. Applies to both molecule and map objects.

## Examples
```python
set_symmetry 1abc, 50.0, 60.0, 70.0, 90, 90, 90, P212121
```

## Related
- [get_symmetry](./get_symmetry.md)
- [symmetry_copy](./symmetry_copy.md)
- [symexp](./symexp.md)

## Source
`packages/engine/modules/pymol/editing.py:379`; signature in `docs/api-reference/commands.mdx:3713`. Parity: implemented in `packages/engine-ts/src/cmd/symmetry.ts`.
