---
name: scene
kind: command
category: movies-scenes-states
subcategory: scenes
summary: Stores and recalls named scenes capturing camera, visibility, colors, representations, frame, and a message.
parity: planned
---

## Purpose
`scene` saves and restores complete visual snapshots. A scene captures the camera view, per-object activity, per-atom visibility and colors, all representations, the global frame index, and an optional text message. Reach for it to build presentations and step through curated views bound to the function keys.

## Syntax
`scene(key='auto', action='recall', message=None, view=1, color=1, active=1, rep=1, frame=1, animate=-1, new_key=None, hand=1, quiet=1, sele='all')`

| Param | Type | Default | Meaning |
| --- | --- | --- | --- |
| `key` | string | `'auto'` | scene name; `new` for auto-numbered, `auto` for current, `*` for all |
| `action` | string | `'recall'` | `store`, `recall`, `insert_after`, `insert_before`, `next`, `previous`, `update`, `rename`, or `clear` |
| `message` | string | `None` | text message displayed on playback |
| `view` | int | `1` | include camera view |
| `color` | int | `1` | include atom colors |
| `active` | int | `1` | include object activity |
| `rep` | int | `1` | include representations |
| `frame` | int | `1` | include global frame index |
| `animate` | float | `-1` | animated transition duration (`-1` = use setting) |
| `new_key` | string | `None` | new name (required for `rename`) |
| `hand` | int | `1` | handedness handling |
| `quiet` | int | `1` | suppress console feedback |
| `sele` | string | `'all'` | selection scope for stored per-atom info |

## Behaviour
Called bare (`scene` with `key='auto'`, `action='recall'`) the action becomes `next`, stepping to the following scene. On `update` the existing message is preserved when `message` is `None`. Deprecated aliases are normalised: `clear`→`delete`, and `append`/`update`→`store`. In presentation mode with `presentation_auto_quit`, a `next`/`previous` past the last scene can quit or chain the session. Scenes F1–F12 are auto-bound to the function keys unless `set_key` overrides them. The `view`/`color`/`active`/`rep`/`frame` flags select which aspects are stored or recalled.

## Examples
```python
scene F1, store, Please note the hydrogen bond shown in yellow.
scene F1
scene F1, rename, new_key=F5
scene *
```

## Related
- [view](../commands/view.md)
- [set_view](../commands/set_view.md)
- [get_view](../commands/get_view.md)
- [scene_order](../commands/scene_order.md)

## Source
`packages/engine/modules/pymol/viewing.py:1034`; signature in `docs/api-reference/commands.mdx:3375`. Parity: no `scene` command registered in `packages/engine-ts/src`; planned.
