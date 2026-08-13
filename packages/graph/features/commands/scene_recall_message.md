---
name: scene_recall_message
kind: command
category: movies-scenes-states
subcategory: internal
summary: Internal helper that displays (or clears) a scene's text message via the Message wizard.
parity: internal
---

## Purpose
`scene_recall_message` is an internal helper — the docstring reads "INTERNAL, DO NOT USE" — that shows a scene's text message on screen when a scene is recalled. It exists to drive the on-screen message overlay during [scene](../commands/scene.md) playback.

## Syntax
`scene_recall_message(message)`

| Param | Type | Default | Meaning |
| --- | --- | --- | --- |
| `message` | string or list | — | message text to display; falsy clears it |

## Behaviour
Checks whether the active wizard is a scene-originated `Message` wizard. If a truthy `message` is given, it is split into lines and pushed via `wizard`/`replace_wizard` (replacing an existing scene message rather than stacking), then flagged `from_scene`. If `message` is empty and a scene message wizard is active, that wizard is cleared. Not for direct use.

## Related
- [scene](../commands/scene.md)
- [replace_wizard](../commands/replace_wizard.md)

## Source
`packages/engine/modules/pymol/viewing.py:1013`; signature in `docs/api-reference/commands.mdx:3410`. Parity: internal; not ported to `packages/engine-ts/src`.
