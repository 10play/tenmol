---
name: madd
kind: command
category: movies-scenes-states
subcategory: movie definition
summary: Extends the existing movie frame-to-state specification using mset syntax.
parity: implemented
---

## Purpose
`madd` appends more frames onto the current movie definition using the same specification grammar as `mset`, rather than replacing it. Use it to build up a movie incrementally instead of writing one long `mset` string.

## Syntax
`madd(specification='', frame=0, freeze=0)`

| Param | Type | Default | Meaning |
| --- | --- | --- | --- |
| `specification` | str | `''` | Frame/state spec in `mset` syntax (e.g. `1 x30 1 -15`) |
| `frame` | int | `0` | Frame at which to insert/extend |
| `freeze` | int | `0` | If set, suppress auto-reinterpolation |

## Behaviour
`madd` is a thin wrapper that calls `mset(specification, frame, freeze)`; unlike `mset` (which defaults `frame=1` and rebuilds the movie), `madd` defaults `frame=0` so the spec extends the existing table. Redefining the movie clears any `mdo`/`mappend` generalized commands attached to affected frames.

## Examples
```python
mset 1 x30
madd 1 -15
madd 15 x30 15 -1
```

## Related
- [mset](../commands/mset.md)
- [mdo](./mdo.md)
- [mappend](./mappend.md)
- [mclear](./mclear.md)

## Source
`packages/engine/modules/pymol/moving.py:677`. Parity: implemented in `packages/engine-ts/src/cmd/system.ts:182` (shares the `append` handler with `mappend`).
