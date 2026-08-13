---
name: undo
kind: command
category: editing-building
subcategory: edit history
summary: Restores the previous conformation of the object currently being edited.
parity: implemented
---

## Purpose
`undo` steps the object currently under edit back one entry on its per-object undo ring, restoring the prior atom conformation. Use it after a sculpting, drag, or set_dihedral operation that you want to reverse.

## Syntax
`undo()` — takes no arguments.

## Behaviour
Under the API lock it calls `_cmd.undo(_COb, -1)`; the `-1` selects the "undo" direction (as opposed to redo). Undo state is stored on each object's individual undo ring by editing operations and `push_undo`; only the object being actively edited is affected. In open-source PyMOL the undo machinery is only partly implemented, so coverage depends on which operations pushed conformations. Raises `pymol.CmdException` on failure when raising is enabled.

## Examples
```python
undo
cmd.undo()
```

## Related
- [redo](../commands/redo.md)
- [push_undo](../commands/push_undo.md)

## Source
`packages/engine/modules/pymol/editing.py:507`. Parity: implemented in `packages/engine-ts/src/cmd/controlflow.ts` and `packages/engine-ts/src/cmd/system.ts`.
