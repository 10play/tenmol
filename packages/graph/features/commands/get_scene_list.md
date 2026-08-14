---
name: get_scene_list
kind: command
category: movies-scenes-states
subcategory: scene introspection
summary: Return the ordered list of stored scene names.
parity: partial
---

## Purpose
`get_scene_list` returns the names of all stored scenes in their current order.
Use it to enumerate scenes for playback, session export, or building a scene menu.

## Syntax
`get_scene_list()`

This command takes no arguments.

## Behaviour
Locks the API and calls the C-layer `get_scene_order`, returning a list of scene
names in display order. This ordering is what `scene` playback and legacy-session
export (`get_session` for `pse_export_version < 1.76`) iterate over.

## Examples
```python
for name in cmd.get_scene_list():
    print(name)
```

## Related
- [get_scene_message](get_scene_message.md), [get_scene_thumbnail](get_scene_thumbnail.md), [scene](scene.md)

## Source
`packages/engine/modules/pymol/viewing.py:919`. Parity: partial — consumed
internally via `ctx.call('get_scene_list')` in
`packages/engine-ts/src/cmd/movie3.ts:655`, backed by a `scene_order` stub in
`packages/engine-ts/src/cmd/extras.ts`.
