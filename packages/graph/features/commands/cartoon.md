---
name: cartoon
kind: command
category: representations-display
subcategory: cartoon
summary: Overrides the cartoon sub-type (loop, tube, arrow, putty, ...) for a selection.
parity: implemented
---

## Purpose
`cartoon` changes the cartoon rendering sub-type for a set of atoms, overriding
the automatic secondary-structure-driven choice. Reach for it to force a region
into tube, putty, arrow, or a flat loop, or to skip cartoon on part of a chain.

## Syntax
`cartoon(type, selection='(all)')`

| Param | Type | Default | Meaning |
| --- | --- | --- | --- |
| `type` | str | — | One of `automatic`, `skip`, `loop`, `rectangle`, `oval`, `tube`, `arrow`, `dumbbell`, `putty`, `dash`, `cylinder`. |
| `selection` | str | `'(all)'` | Atoms whose cartoon type is set. |

## Behaviour
`type` is resolved via a shortcut against the `cartoon_dict` mapping (e.g.
`automatic`=0, `skip`=-1, `loop`=1, `tube`=4, `arrow`=5, `putty`=7); the
selection is processed with `selector.process`. The command only sets the
cartoon type flag on atoms — the cartoon representation itself must be shown
(`show cartoon`) for the change to be visible. This command is rarely needed
because the default `automatic` mode chooses cartoons from PDB HELIX/SHEET
records.

## Examples
```
cartoon rectangle, chain A
cartoon skip, resi 145-156
cartoon putty
```

## Related
- [show](../commands/show.md)
- [set](../commands/set.md)

## Source
`packages/engine/modules/pymol/viewing.py:1543`. Ported in
`packages/engine-ts/src/cmd/preset.ts` (and related cartoon code).
