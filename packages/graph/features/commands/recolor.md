---
name: recolor
kind: command
category: coloring
summary: Force reapplication of colors to existing representation objects.
parity: implemented
---

## Purpose
`recolor` reapplies colors to already-built representations. It is most often
needed after `set_color` redefines a named color that existing objects use — the
geometry keeps its old color until you recolor it.

## Syntax
`recolor(selection='all', representation='everything')`

| Param | Type | Default | Meaning |
| --- | --- | --- | --- |
| `selection` | string | `'all'` | atoms whose representations to recolor |
| `representation` | string | `'everything'` | which representation(s) to recolor |

## Behaviour
Processes `selection` through the selector and validates `representation` against
the representation shortcut table, then re-runs color application on the matching
reps without rebuilding geometry. Unlike `color`, it assigns no new color — it
re-evaluates existing color assignments (including ramps and `set_color`
redefinitions). `recolour` is the British-spelling alias.

## Examples
```
set_color myblue, [0.1, 0.3, 0.9]
recolor
```

## Related
- [recolour](../commands/recolour.md)
- [color](../commands/color.md)
- [set_color](../commands/set_color.md)

## Source
`packages/engine/modules/pymol/viewing.py:1868` (`def recolor`). Parity:
implemented in `packages/engine-ts/src/cmd/display.ts:154`.
