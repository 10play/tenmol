---
name: rebuild
kind: command
category: representations-display
summary: Force PyMOL to recreate geometric representation objects that may be out of sync.
parity: implemented
---

## Purpose
`rebuild` forces PyMOL to regenerate the geometry for representations, in case any
have gone out of sync with the underlying data. Reach for it after low-level
changes (scripted `alter`, certain setting changes) when the display does not
reflect the current model.

## Syntax
`rebuild(selection='all', representation='everything')`

| Param | Type | Default | Meaning |
| --- | --- | --- | --- |
| `selection` | string | `'all'` | atoms whose representations to rebuild |
| `representation` | string | `'everything'` | which representation(s) to rebuild |

## Behaviour
Processes `selection` through the selector and validates `representation` against
the representation shortcut table (`everything` covers all reps), then triggers a
full geometry rebuild for the matching reps. This is heavier than `refresh`, which
only redraws; `rebuild` discards and recreates the geometry. `representation` is a
keyword-only argument in the Python signature.

## Examples
```
rebuild
rebuild polymer, cartoon
```

## Related
- [refresh](../commands/refresh.md)
- [recolor](../commands/recolor.md)

## Source
`packages/engine/modules/pymol/viewing.py:1837` (`def rebuild`). Parity:
implemented in `packages/engine-ts/src/cmd/display.ts:158`.
