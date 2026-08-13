---
name: is_dict
kind: command
category: internal
subcategory: type predicate
summary: Return True if the given object is a Python dict.
parity: internal
---

## Purpose
Internal type-checking helper used throughout the PyMOL Python layer to branch on argument
types. You rarely call it directly; it exists so command wrappers can distinguish dict-valued
arguments from other containers.

## Syntax
`is_dict(obj)`

| Param | Type | Default | Meaning |
| --- | --- | --- | --- |
| `obj` | any | — | value to test |

## Behaviour
Thin wrapper over `isinstance(obj, dict)`. Returns a plain Python bool. No locking, no C call,
no side effects.

## Examples
```python
from pymol import cmd
cmd.is_dict({'a': 1})   # True
cmd.is_dict([1, 2])     # False
```

## Related
[is_list](is_list.md), [is_tuple](is_tuple.md), [is_sequence](is_sequence.md)

## Source
`packages/engine/modules/pymol/checking.py:19`. Parity: not ported to engine-ts (a pure Python
type predicate with no engine-side behaviour).
