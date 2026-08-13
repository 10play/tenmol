---
name: recolour
kind: command
category: coloring
summary: British-spelling alias of recolor — reapplies colors to existing objects.
parity: implemented
---

## Purpose
`recolour` is the British-spelling alias for [`recolor`](../commands/recolor.md).
It forces reapplication of colors to existing representations, typically after
`set_color` redefines a color that current objects use.

## Syntax
`recolour(selection='all', representation='everything')`

| Param | Type | Default | Meaning |
| --- | --- | --- | --- |
| `selection` | string | `'all'` | atoms whose representations to recolor |
| `representation` | string | `'everything'` | which representation(s) to recolor |

## Behaviour
Identical to `recolor`: re-evaluates and reapplies existing color assignments to
matching representations without rebuilding geometry. See `recolor` for details.

## Examples
```
recolour all, cartoon
```

## Related
- [recolor](../commands/recolor.md)
- [set_color](../commands/set_color.md)

## Source
`packages/engine/modules/pymol/viewing.py` (alias of `recolor`). Parity:
implemented as an alias forwarding to `recolor` in
`packages/engine-ts/src/cmd/topics.ts:145`.
