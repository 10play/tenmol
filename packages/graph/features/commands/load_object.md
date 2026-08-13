---
name: load_object
kind: command
category: file-io
subcategory: generic loader
summary: General developer entry point that loads a Python object of a given numeric loadable type into PyMOL.
parity: unknown
---

## Purpose
`load_object` is the low-level, general-purpose developer function that every
in-memory loader (`load_cgo`, `load_model`, `load_map`, `load_callback`,
`load_brick`) is built on. You pass a numeric `loadable` type code plus the Python
object, and PyMOL routes it to the correct C-side loader.

## Syntax
`load_object(type, object, name, state=0, finish=1, discrete=0, quiet=1, zoom=-1)`

| Param | Type | Default | Meaning |
| --- | --- | --- | --- |
| `type` | int | — | one of the numeric `cmd.loadable` type codes |
| `object` | any | — | the Python object to load |
| `name` | str | — | destination object name |
| `state` | int | 0 | 1-based state; 0 appends after the last state |
| `finish` | int | 1 | perform (1) or defer (0) post-processing |
| `discrete` | int | 0 | treat each state as an independent, unrelated atom set |
| `quiet` | int | 1 | suppress chatter |
| `zoom` | int | -1 | auto-zoom behaviour |

## Behaviour
The call takes the API lock and forwards to `_cmd.load_object`, converting `state`
to 0-based (`state-1`) so the C loader appends when `state==0`. `finish=0` defers
per-object post-processing for bulk loads (call `finish_object` afterwards);
`discrete=1` trades editability for memory when states share no atoms. Numeric type
codes come from the `loadable` namespace (see [loadable](loadable.md)).

## Examples
```python
from pymol.cgo import COLOR, SPHERE
cmd.load_object(cmd.loadable.cgo, [COLOR,1,0,0, SPHERE,0,0,0,1], "ball")
```

## Related
- [loadable](loadable.md) — the numeric type-code namespace
- [load_cgo](load_cgo.md), [load_model](load_model.md), [load_map](load_map.md) — thin wrappers over this

## Source
`packages/engine/modules/pymol/importing.py:185` (`def load_object`). Not present in
`packages/engine-ts/src`.
