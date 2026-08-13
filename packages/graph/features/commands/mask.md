---
name: mask
kind: command
category: selecting
subcategory: pick protection
summary: Makes the indicated atoms unpickable with the mouse (protects them from accidental selection).
parity: implemented
---

## Purpose
`mask` makes atoms impossible to select by clicking in the viewer. Reach for it when a molecule in the foreground keeps grabbing clicks meant for one behind it, or to lock down a region so you cannot accidentally pick it while editing. Reversed by `unmask`.

## Syntax
`mask(selection='(all)', quiet=1)`

| Param | Type | Default | Meaning |
| --- | --- | --- | --- |
| `selection` | str | `'(all)'` | Atoms to make unpickable |
| `quiet` | int | `1` | Suppress feedback when set |

## Behaviour
The selection is run through `selector.process` and wrapped in parentheses, then `_cmd.mask` is called with flag `1` (mask on). Masking affects mouse picking only — it does not hide atoms or block programmatic selection by name/logic. `unmask` calls the same primitive with flag `0`. Distinct from `protect`/`deprotect`, which guard atoms against transformation/editing rather than picking.

## Examples
```python
mask polymer
mask chain B
unmask all
```

## Related
- [unmask](../commands/unmask.md)
- [protect](../commands/protect.md)
- [deprotect](../commands/deprotect.md)

## Source
`packages/engine/modules/pymol/controlling.py:870`. Parity: implemented in `packages/engine-ts/src/cmd/extras.ts:252`.
