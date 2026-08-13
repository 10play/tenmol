---
name: sculpt_activate
kind: command
category: sculpting-minimization
subcategory: sculpting
summary: Enables sculpting for an object, remembering the current geometry as the reference for restraints.
parity: implemented
---

## Purpose
`sculpt_activate` turns on real-time sculpting for an object. It snapshots the object's current geometry (bond lengths, angles, etc.) in the given state to use as the reference against which sculpting restraints pull. Reach for it before [sculpt_iterate](../commands/sculpt_iterate.md) to relax or reshape a structure while preserving good local geometry.

## Syntax
`sculpt_activate(object, state=0, match_state=-1, match_by_segment=0)`

| Param | Type | Default | Meaning |
| --- | --- | --- | --- |
| `object` | string | — | single object name, or `"all"` |
| `state` | int | `0` | object state to sculpt (`0` = current) |
| `match_state` | int | `-1` | state whose geometry is used as the reference |
| `match_by_segment` | int | `0` | match reference geometry per segment |

## Behaviour
Records the reference geometry from the specified state; subsequent `sculpt_iterate` calls apply restraints (bonds, angles, VDW, etc., governed by the `sculpt_*` settings) that pull the structure back toward that reference while you drag atoms. `state` and `match_state` are converted from 1-based to 0-based before the C call. Pass `object="all"` to activate sculpting on every object. Turn it off with [sculpt_deactivate](../commands/sculpt_deactivate.md).

## Examples
```python
sculpt_activate myprotein
sculpt_activate all, state=1
```

## Related
- [sculpt_iterate](../commands/sculpt_iterate.md)
- [sculpt_deactivate](../commands/sculpt_deactivate.md)

## Source
`packages/engine/modules/pymol/editing.py:144`; signature in `docs/api-reference/commands.mdx:3416`. Parity: implemented in `packages/engine-ts/src/cmd/sculpt.ts:336`.
