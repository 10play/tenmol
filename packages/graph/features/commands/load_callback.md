---
name: load_callback
kind: command
category: file-io
subcategory: import
summary: Load a generic Python callback object that fires on every screen update (e.g. for custom OpenGL).
parity: unknown
---

## Purpose
Register a Python callback object that PyMOL invokes each time the screen is redrawn. Used to hook
custom rendering into the scene — for example issuing PyOpenGL draw calls alongside PyMOL's own
graphics.

## Syntax
`load_callback(*arg)`

Typical positional order: `callback_object, name, state, finish, discrete`.

| Param | Type | Default | Meaning |
| --- | --- | --- | --- |
| `object` | callback | — | the Python callback object to install |
| `name` | string | — | name for the resulting object |
| `state` | int | — | state to load into |
| `finish` | int | — | finish/update flag |
| `discrete` | int | — | discrete-states flag |

## Behaviour
Prepends the `loadable.callback` type constant and forwards to `load_object`. The callback is
called on every screen refresh, so it is the entry point for drawing custom OpenGL each frame. No
keyword handling of its own beyond what `load_object` accepts.

## Examples
```python
cmd.load_callback(my_callback, "overlay")
```

## Related
[load](load.md), [load_cgo](load_cgo.md), load_object

## Source
`packages/engine/modules/pymol/importing.py:291`. Parity: not found in engine-ts; status unknown
(depends on a live OpenGL redraw loop the TS engine does not replicate).
