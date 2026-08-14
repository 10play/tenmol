---
name: unmask
kind: command
category: selecting
subcategory: picking mask
summary: Reverses the effect of "mask" on the indicated atoms, re-enabling mouse picking.
parity: implemented
---

## Purpose
`unmask` clears the mask flag on atoms so they can once again be picked and selected with the mouse. It undoes a prior `mask`, which had made those atoms unpickable in the viewer.

## Syntax
`unmask(selection='(all)', quiet=1)`

| Param | Type | Default | Meaning |
| --- | --- | --- | --- |
| `selection` | selection | `'(all)'` | atoms to unmask |
| `quiet` | int | `1` | suppress feedback |

## Behaviour
The selection is processed and passed to `_cmd.mask(_COb, "(sel)", 0, quiet)` — the shared mask entry point with flag value `0` (unmask). Masking only affects interactive mouse picking; it does not hide atoms or change selections made by command. With the default `(all)` it re-enables picking everywhere.

## Examples
```python
# make everything pickable again
unmask

# unmask only the ligand
unmask resn LIG
```

## Related
- [mask](../commands/mask.md)
- [protect](../commands/protect.md)
- [deprotect](../commands/deprotect.md)

## Source
`packages/engine/modules/pymol/controlling.py:897`. Parity: implemented in `packages/engine-ts/src/cmd/extras.ts`.
