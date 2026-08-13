---
name: is_tuple
kind: command
category: internal
subcategory: type predicate
summary: Return True if the given object is a Python tuple.
parity: internal
---

## Purpose
Internal type-checking helper for command wrappers that need to tell a `tuple` apart from a
`list` (both of which `is_sequence` accepts).

## Syntax
`is_tuple(obj)`

| Param | Type | Default | Meaning |
| --- | --- | --- | --- |
| `obj` | any | — | value to test |

## Behaviour
Thin wrapper over `isinstance(obj, tuple)`. Returns a plain Python bool with no side effects.

## Examples
```python
from pymol import cmd
cmd.is_tuple((1, 2))    # True
cmd.is_tuple([1, 2])    # False
```

## Related
[is_list](is_list.md), [is_sequence](is_sequence.md)

## Source
`packages/engine/modules/pymol/checking.py:22`. Parity: not ported to engine-ts (pure Python
predicate).
