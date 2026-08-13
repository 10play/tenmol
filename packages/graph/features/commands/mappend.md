---
name: mappend
kind: command
category: movies-scenes-states
subcategory: movie commands
summary: Appends generalized command-line operations to a movie frame (additive counterpart of mdo).
parity: implemented
---

## Purpose
`mappend` attaches extra command-line text to a numbered movie frame so those commands run every time that frame plays. Unlike `mdo`, it *adds* to whatever is already associated with the frame instead of replacing it. Use it to layer several actions onto the same frame.

## Syntax
`mappend(frame, command)`

| Param | Type | Default | Meaning |
| --- | --- | --- | --- |
| `frame` | int | — | The 1-based frame to modify |
| `command` | str | — | Literal command-line text (may contain `;`-separated commands) |

## Behaviour
Internally calls `_cmd.mdo(frame-1, ";"+command, 1)` — the leading `;` and the append flag (`1`) distinguish it from `mdo`, which passes flag `0` to overwrite. The movie must first be defined with `mset`; redefining the movie clears all `mdo`/`mappend` commands on affected frames. Multiple `mappend` calls on the same frame accumulate.

## Examples
```python
mappend 1: hide everything; show sticks
mappend 60: hide sticks; show spheres
mappend 120: hide spheres; show surface
```

## Related
- [mdo](./mdo.md)
- [madd](./madd.md)
- [mset](../commands/mset.md)
- [mplay](../commands/mplay.md)

## Source
`packages/engine/modules/pymol/moving.py:323`. Parity: implemented in `packages/engine-ts/src/cmd/system.ts:183`.
