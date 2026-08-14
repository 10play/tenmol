---
name: auto_measure
kind: command
category: measurement
subcategory: interactive measurement
summary: Automatically creates a distance, angle, or dihedral from the currently picked atoms.
parity: unknown
---

## Purpose
`auto_measure` inspects the current pick selections (pk1..pk4) and creates the appropriate geometric measurement automatically, then clears the picks. It is the "measure whatever I've picked" convenience bound to the interactive picking workflow.

## Syntax
`auto_measure()` — takes no arguments.

## Behaviour
It reads `get_names("selections")` and branches on how many pick atoms exist: pk1+pk2 → `distance`, pk1+pk2+pk3 → `angle`, pk1+pk2+pk3+pk4 → `dihedral`. After creating the measurement it calls `unpick()` to clear the picks so the next selection starts fresh. With fewer than two picks it does nothing measurable.

## Examples
```python
# pick two atoms, then:
auto_measure          # -> creates a distance
# pick a third atom first, then auto_measure -> creates an angle
```

## Related
- [angle](./angle.md)
- [distance](../commands/distance.md)
- [dihedral](../commands/dihedral.md)

## Source
`packages/engine/modules/pymol/querying.py:27`. Parity: unknown — no `auto_measure` command registered in `packages/engine-ts/src`; its building blocks (`distance`/`angle`/`dihedral`) are ported.
