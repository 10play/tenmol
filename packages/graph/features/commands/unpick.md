---
name: unpick
kind: command
category: selecting
subcategory: edit picking
summary: Deletes the special "pk" atom selections (pk1, pk2, …) used in picking and editing.
parity: partial
---

## Purpose
`unpick` clears the transient `pk1`, `pk2`, … selections that PyMOL creates when you pick atoms for molecular editing. Use it to deactivate the current edit state and remove the pink editing markers from the display.

## Syntax
`unpick()` — takes no arguments.

## Behaviour
Under the API lock it calls `_cmd.unpick(_COb)`, which discards all `pk` named selections. This ends the active edit session (the object is no longer "being edited"), so subsequent editing commands that default to `(pk1)`/`(pk2)` will have no picked atoms to act on until you pick again. Raises `pymol.CmdException` on failure when raising is enabled.

## Examples
```python
unpick
cmd.unpick()
```

## Related
- [edit](../commands/edit.md)

## Source
`packages/engine/modules/pymol/editing.py:991`. Parity: registered as a documented no-op in `packages/engine-ts/src/cmd/extras.ts` (no live picking model in the TS port).
