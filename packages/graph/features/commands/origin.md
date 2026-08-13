---
name: origin
kind: command
category: viewing-camera
subcategory: rotation center
summary: Sets the center of rotation to a selection, object, or explicit position.
parity: implemented
---

## Purpose
`origin` moves the point that the camera rotates and turns around. Set it to a
selection to spin the view about a binding site, or to an object to define its
pivot for animation and editing. It underpins turntable animations and focused
inspection.

## Syntax
```
origin(selection='(all)', object=None, position=None, state=0)
```

| Param | Type | Default | Meaning |
| --- | --- | --- | --- |
| `selection` | string | `'(all)'` | selection or name-list whose center becomes the origin |
| `object` | str | `None` | object name to set an object-specific rotation center |
| `position` | list | `None` | explicit `[x,y,z]` origin; overrides `selection` when given |
| `state` | int | `0` | 0 = all states; -1 = current state; >0 = a specific state |

## Behaviour
The selection is preprocessed; `object` defaults to `''` and `position` to
`(0,0,0)` when unset. If `position` is supplied (a list, or a string that is
`safe_list_eval`'d), it takes precedence and the selection is cleared, so the
origin is placed at that exact coordinate. Providing an `object` name sets the
rotation center used for that object's own transformations rather than the global
camera. State is converted to 0-based internally.

## Examples
```
origin chain A
origin position=[1.0, 2.0, 3.0]
origin lig, object=lig
```

## Related
- `zoom`, [orient](orient.md), `reset` - related camera framing commands

## Source
`packages/engine/modules/pymol/viewing.py:256`. Registered in the TS port at
`packages/engine-ts/src/cmd/transforms.ts:265`.
