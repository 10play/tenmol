---
name: get_clip
kind: command
category: viewing-camera
subcategory: clipping planes
summary: Returns the current positions of the near and far clipping planes.
parity: unknown
---

## Purpose
`get_clip` returns the current positions of the front (near) and back (far) clipping planes. Reach for it to read the clip state, for example to save and later restore it around a `clip` manipulation.

## Syntax
`get_clip(quiet=1)`

| Param | Type | Default | Meaning |
| --- | --- | --- | --- |
| `quiet` | int | `1` | If `0`, prints the returned clip values |

## Behaviour
Acquires the lock and dispatches to `_cmd.get_clip`, returning the clipping-plane positions. With `quiet=0` the result is printed. It is the read counterpart to the [clip](../commands/clip.md) command, which moves the planes.

## Examples
```python
planes = cmd.get_clip()
cmd.get_clip(quiet=0)
```

## Related
- [clip](../commands/clip.md)
- [get_view](../commands/get_view.md)

## Source
Upstream `packages/engine/modules/pymol/viewing.py:228`. Parity: unknown — no dedicated `get_clip` command found in `packages/engine-ts/src` (the `clip` command itself is implemented in `packages/engine-ts/src/cmd/transforms.ts:296`).
