---
name: dss
kind: command
category: editing-building
subcategory: secondary structure
summary: Assigns secondary structure (helix/sheet/loop) from backbone geometry and hydrogen-bonding patterns.
parity: implemented
---

## Purpose
`dss` (Define Secondary Structure) computes per-residue secondary-structure assignments used to draw cartoons. PyMOL emphasizes cartoon aesthetics, so it combines hydrogen-bonding patterns and backbone geometry rather than reproducing DSSP exactly.

## Syntax
`dss(selection='(all)', state=0, context=None, preserve=0, quiet=1)`

| Param | Type | Default | Meaning |
| --- | --- | --- | --- |
| `selection` | selection | `'(all)'` | Atoms to assign |
| `state` | int | `0` | State to analyze; 0 = all states |
| `context` | selection | `None` | Additional context atoms considered during assignment |
| `preserve` | 0/1 | `0` | Keep existing assignments where already set |
| `quiet` | 0/1 | `1` | Suppress feedback |

## Behaviour
The selection (and `context`, if given) are run through `selector.process`; `state` is converted to zero-based before `_cmd.dss`. Assignments differ slightly from DSSP: PyMOL is generally stricter (fewer helix/strand residues) except it tolerates partially distorted helices. The docstring warns the algorithm has not been rigorously validated. To override individual assignments, use `alter ..., ss='H'/'S'/'L'` followed by `rebuild`.

## Examples
```python
dss
dss chain A, state=1
alter 123-125/, ss='L'
rebuild
```

## Related
- [alter](../commands/alter.md)
- [rebuild](../commands/rebuild.md)
- [cartoon](../commands/cartoon.md)

## Source
`packages/engine/modules/pymol/editing.py:1638`. Parity: implemented in `packages/engine-ts/src/cmd/analysis.ts`.
