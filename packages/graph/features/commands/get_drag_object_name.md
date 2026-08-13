---
name: get_drag_object_name
kind: command
category: querying
subcategory: editing state
summary: Returns the name of the object currently in drag (mouse-move) mode.
parity: unknown
---

## Purpose
`get_drag_object_name` reports which object, if any, is presently the target of interactive drag/move editing. It is a low-level introspection helper used by the GUI and builder to know what the mouse is currently manipulating.

## Syntax
`get_drag_object_name()`

Takes no positional arguments (only the internal `_self`).

## Behaviour
Acquires the command lock and returns the result of `_cmd.get_drag_object_name`, typically the object name string (or empty/None when nothing is being dragged). There is no docstring in the engine; behaviour is inferred from its C dispatch.

## Examples
```python
name = cmd.get_drag_object_name()
```

## Related
- [get_editor_scheme](./get_editor_scheme.md)
- [drag](../commands/drag.md)

## Source
`packages/engine/modules/pymol/querying.py:84`. Parity: no TypeScript port found; parityStatus unknown.
