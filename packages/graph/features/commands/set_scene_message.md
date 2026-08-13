---
name: set_scene_message
kind: command
category: movies-scenes-states
subcategory: scenes
summary: Sets the text message/annotation associated with a named scene.
parity: unknown
---

## Purpose
`set_scene_message` attaches (or replaces) the on-screen text message that PyMOL displays while a given scene is active. It is the programmatic setter behind the scene "message" that `scene` can store alongside camera, color and representation state.

## Syntax
`set_scene_message(name, message)`

| Param | Type | Default | Meaning |
| --- | --- | --- | --- |
| `name` | string | — | Scene name |
| `message` | string | — | Text to display when the scene is recalled |

## Behaviour
A thin, lock-guarded pass-through to the C layer (`_cmd.set_scene_message`). It has no `quiet` or state arguments; it simply stores the message string for the named scene. Retrieve it with `get_scene_message`. If the scene does not exist the underlying call is a no-op at the C level.

## Examples
```python
scene F1, store
set_scene_message F1, "Active site, catalytic triad highlighted"
```

## Related
- [scene](./scene.md)
- [get_scene_list](./get_scene_list.md)

## Source
`packages/engine/modules/pymol/viewing.py:931`; signature in `docs/api-reference/commands.mdx:3686`. Parity: not located in the TypeScript port — unknown.
