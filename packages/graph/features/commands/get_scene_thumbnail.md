---
name: get_scene_thumbnail
kind: command
category: movies-scenes-states
subcategory: scene introspection
summary: Return the stored thumbnail image data for a named scene.
parity: unknown
---

## Purpose
`get_scene_thumbnail` retrieves the small preview image PyMOL caches for a stored
scene. Use it to build a scene gallery or thumbnail strip in a UI.

## Syntax
`get_scene_thumbnail(name)`

| Param | Type | Default | Meaning |
| --- | --- | --- | --- |
| `name` | str | — | Name of the scene |

## Behaviour
Locks the API and calls the C-layer `get_scene_thumbnail`, returning the scene's
cached thumbnail image data (the preview captured when the scene was stored).

## Examples
```python
thumb = cmd.get_scene_thumbnail("intro")
```

## Related
- [get_scene_list](get_scene_list.md), [get_scene_message](get_scene_message.md), [scene](scene.md)

## Source
`packages/engine/modules/pymol/viewing.py:923`. Parity: unknown — not registered
in `packages/engine-ts/src`.
