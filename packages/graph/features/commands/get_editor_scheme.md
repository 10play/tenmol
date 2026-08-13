---
name: get_editor_scheme
kind: command
category: editing-building
subcategory: editor state
summary: Returns the current builder/editor scheme mode as an integer code.
parity: unknown
---

## Purpose
`get_editor_scheme` queries the active editing scheme of the molecular editor, which governs how mouse actions are interpreted while building/editing. It is primarily used internally by the builder GUI to reflect editor state.

## Syntax
`get_editor_scheme()`

Takes no positional arguments (only the internal `_self`).

## Behaviour
Locks the command layer and returns `_cmd.get_editor_scheme`, an integer scheme code. Raises `CmdException` on error (via `_raising`). No engine docstring is provided; the return encodes the editor's current interaction scheme.

## Examples
```python
scheme = cmd.get_editor_scheme()
```

## Related
- [edit_mode](../commands/edit_mode.md)
- [get_drag_object_name](./get_drag_object_name.md)

## Source
`packages/engine/modules/pymol/editing.py:1125`. Parity: no TypeScript port found; parityStatus unknown.
