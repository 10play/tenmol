---
name: redo
kind: command
category: editing-building
subcategory: undo/redo
summary: Reapply the last undone conformational change to the object being edited.
parity: implemented
---

## Purpose
`redo` reapplies a conformational change that was reverted with `undo`, for the
object currently being edited. It is the counterpart to `undo` in the editing
undo stack.

## Syntax
```
redo
```
Takes no arguments.

## Behaviour
Calls the engine undo machinery with the redo direction (`_cmd.undo(COb, 1)`). It
operates on the object currently being edited and only affects conformational
(coordinate) changes captured on the undo stack. Pairs with `push_undo`, which
records a restorable state.

## Examples
```
redo
```

## Related
- [undo](../commands/undo.md)
- [push_undo](../commands/push_undo.md)

## Source
`packages/engine/modules/pymol/editing.py` (`def redo`). Parity: implemented in
`packages/engine-ts/src/cmd/controlflow.ts:158`.
