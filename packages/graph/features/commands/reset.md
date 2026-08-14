---
name: reset
kind: command
category: viewing-camera
subcategory: camera reset
summary: Restores the camera to identity rotation, recenters the origin, and re-zooms to fit all objects.
parity: planned
---

## Purpose
`reset` returns the view to a clean default: the rotation matrix is set to identity, the origin moves to the (approximate) center of mass, and the window plus clipping planes are zoomed to encompass all loaded objects. Reach for it to recover from a disorienting camera state, or pass an object name to reset that object's transformation matrix instead.

## Syntax
`reset(object='')`

| Param | Type | Default | Meaning |
| --- | --- | --- | --- |
| `object` | string | `''` | if given, reset this object's matrix instead of the global camera |

## Behaviour
With no argument the whole camera is reset: identity rotation, center-of-mass origin, and a fit-to-all zoom. When `object` names an object, `reset` instead clears the transformation matrix associated with that object (undoing any `rotate`/`translate` applied to its matrix), leaving the global camera untouched. This is a fit reset, not a full session reinitialize (see [reinitialize](../commands/reinitialize.md)).

## Examples
```python
reset
reset myobject
```

## Related
- [zoom](../commands/zoom.md)
- [orient](../commands/orient.md)
- [reinitialize](../commands/reinitialize.md)

## Source
`packages/engine/modules/pymol/viewing.py:1774`; signature in `docs/api-reference/commands.mdx:3259`. Parity: no `reset` command registered in `packages/engine-ts/src` (used via the bridge from UI quick-buttons); planned in the TS engine.
