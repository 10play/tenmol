---
name: is_list
kind: command
category: internal
subcategory: type predicate
summary: Return True if the given object is a Python list.
parity: internal
---

## Purpose
Internal type-checking helper used by command wrappers to distinguish a `list` from other
container types (notably from tuples, which `is_sequence` would also accept).

## Syntax
`is_list(obj)`

| Param | Type | Default | Meaning |
| --- | --- | --- | --- |
| `obj` | any | — | value to test |

## Behaviour
Thin wrapper over `isinstance(obj, list)`. Returns a plain Python bool with no side effects.

## Examples
```python
from pymol import cmd
cmd.is_list([1, 2])     # True
cmd.is_list((1, 2))     # False
```

## Related
[is_tuple](is_tuple.md), [is_sequence](is_sequence.md), [is_dict](is_dict.md)

## Source
`packages/engine/modules/pymol/checking.py:16`. Parity: not ported to engine-ts (pure Python
predicate).
