---
name: count_states
kind: command
category: movies-scenes-states
subcategory: object states
summary: Returns the number of coordinate states in a selection's object(s).
parity: implemented
---

## Purpose
`count_states` returns how many states (coordinate sets) an object or selection has, e.g. the number of models in an NMR ensemble or trajectory frames. Use it to size loops over states and to drive state pickers.

## Syntax
`count_states(selection='(all)', quiet=1)`

| Param | Type | Default | Meaning |
| --- | --- | --- | --- |
| `selection` | str | `'(all)'` | Selection whose object states are counted |
| `quiet` | int | `1` | Suppress the "count_states: N states." print when `1` |

## Behaviour
Preprocesses the selection, locks the session, and returns the maximum state count over the matched objects. With `quiet=0` it prints the count. A single-state object returns 1. Commonly called as `count_states('?' + name)` to guard against non-existent objects.

## Examples
```python
count_states 1nmr
count_states all, quiet=0
```

## Related
- [count_frames](../commands/count_frames.md)
- [frame](../commands/frame.md)

## Source
`packages/engine/modules/pymol/querying.py:703` (`def count_states`). Ported: `packages/engine-ts/src/cmd/analysis.ts:224` (`ctx.command('count_states', ...)`).
