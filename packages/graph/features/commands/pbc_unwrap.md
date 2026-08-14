---
name: pbc_unwrap
kind: command
category: symmetry
subcategory: periodic boundaries
summary: Unwraps molecules or atoms so trajectories don't jump across PBC boundaries.
parity: partial
---

## Purpose
`pbc_unwrap` fixes the visual discontinuities in molecular-dynamics trajectories
where atoms leap from one side of the periodic box to the other. It restores
continuous coordinates so bonds, molecules and diffusion look physically sensible
across frames.

## Syntax
```
pbc_unwrap(oname, bymol=True)
```

| Param | Type | Default | Meaning |
| --- | --- | --- | --- |
| `oname` | str | | object name to unwrap |
| `bymol` | 0/1 | `True` | unwrap whole molecules (1) rather than individual atoms (0) |

## Behaviour
Locks the C layer and calls `_cmd.pbc_unwrap(oname, int(bymol))`. With
`bymol=1` (the default) each molecule is kept intact as it is unwrapped, which
avoids splitting bonded groups; `bymol=0` unwraps atom by atom. It relies on the
object carrying valid unit-cell/symmetry information. Complementary to
[pbc_wrap](pbc_wrap.md), which does the opposite.

## Examples
```
pbc_unwrap trajectory
pbc_unwrap trajectory, bymol=0
```

## Related
- [pbc_wrap](pbc_wrap.md) - wrap molecules back into the box

## Source
`packages/engine/modules/pymol/editing.py:312`. Present as a no-op stub in the TS
port (`packages/engine-ts/src/cmd/extras.ts:559`), so parity is partial.
