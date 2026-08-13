---
name: push_undo
kind: command
category: editing-building
subcategory: undo stack
summary: Pushes the current object conformations onto their per-object undo rings.
parity: implemented
---

## Purpose
`push_undo` snapshots the current conformation of the objects in a selection onto
each object's undo ring, so a subsequent edit can be reversed with `undo`. Scripts
call it before a mutating operation to make that operation undoable.

## Syntax
```
push_undo(selection, just_coordinates=1, finish_undo=0, add_objects=0,
          delete_objects=0, state=0)
```

| Param | Type | Default | Meaning |
| --- | --- | --- | --- |
| `selection` | str | | objects whose conformations are pushed |
| `just_coordinates` | int | `1` | store only coordinates (not full topology) |
| `finish_undo` | int | `0` | finalize the pending undo step |
| `add_objects` | int | `0` | track object additions in the undo record |
| `delete_objects` | int | `0` | track object deletions in the undo record |
| `state` | int | `0` | coordinate state to snapshot |

## Behaviour
The selection is preprocessed and passed to `_cmd.push_undo` with a 0-based
state. Upstream notes that this command is only partly implemented in open-source
PyMOL — the coordinate-undo path works but the object add/delete tracking
parameters are not fully wired. Each object maintains its own undo ring, so the
push is per-object.

## Examples
```
push_undo (all)
push_undo lig
```

## Related
- `undo`, `redo` - traverse the undo ring

## Source
`packages/engine/modules/pymol/editing.py:531`. Registered in the TS port at
`packages/engine-ts/src/cmd/controlflow.ts:134`.
