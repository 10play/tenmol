---
name: update
kind: command
category: editing-building
subcategory: coordinate transfer
summary: Transfers coordinates from a source selection onto a target selection.
parity: implemented
---

## Purpose
`update` copies atomic coordinates from one selection into the matching atoms of another, without altering the target's identity or bonding. Use it to propagate a moved/refined conformation from a variant object back onto an original.

## Syntax
`update(target, source, target_state=0, source_state=0, matchmaker=1, quiet=1)`

| Param | Type | Default | Meaning |
| --- | --- | --- | --- |
| `target` | selection | — | atoms to receive coordinates |
| `source` | selection | — | atoms to copy coordinates from |
| `target_state` | int | `0` | target state (0 = all) |
| `source_state` | int | `0` | source state (0 = all) |
| `matchmaker` | int | `1` | atom-matching mode used to pair target/source atoms |
| `quiet` | int | `1` | suppress feedback |

## Behaviour
Both selections are processed and wrapped in parentheses, then `_cmd.update(_COb, target, source, target_state-1, source_state-1, matchmaker, quiet)` pairs atoms and overwrites the target coordinates. Note (from the source): it currently applies across all pairs of states; fine per-state control is not yet available. Only coordinates move — topology, names, and settings of the target are untouched.

## Examples
```python
update target, (variant)

# copy a refined chain's coordinates onto the original
update orig and chain A, refined and chain A
```

## Related
- [load](../commands/load.md)

## Source
`packages/engine/modules/pymol/editing.py:2521`. Parity: implemented in `packages/engine-ts/src/cmd/controlflow.ts` and `packages/engine-ts/src/cmd/system.ts`.
