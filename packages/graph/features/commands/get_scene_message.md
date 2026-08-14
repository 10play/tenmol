---
name: get_scene_message
kind: command
category: movies-scenes-states
subcategory: scene introspection
summary: Return the text message/annotation stored with a named scene.
parity: unknown
---

## Purpose
`get_scene_message` retrieves the annotation text attached to a stored scene (the
on-screen message shown when the scene is recalled). Use it to read or export a
scene's caption.

## Syntax
`get_scene_message(name)`

| Param | Type | Default | Meaning |
| --- | --- | --- | --- |
| `name` | str | — | Name of the scene |

## Behaviour
Locks the API and calls the C-layer `get_scene_message`, returning the scene's
stored message string. Paired with `set_scene_message`, which writes it.

## Examples
```python
msg = cmd.get_scene_message("intro")
```

## Related
- [get_scene_list](get_scene_list.md), [get_scene_thumbnail](get_scene_thumbnail.md), [scene](scene.md)

## Source
`packages/engine/modules/pymol/viewing.py:927`. Parity: unknown — not registered
in `packages/engine-ts/src`.
