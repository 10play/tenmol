---
name: is_sequence
kind: command
category: internal
subcategory: type predicate
summary: Return True if the given object is a list or a tuple.
parity: internal
---

## Purpose
Internal type-checking helper used where either a `list` or a `tuple` is acceptable — e.g. when
a wrapper coerces an argument that may be given as either sequence type.

## Syntax
`is_sequence(obj)`

| Param | Type | Default | Meaning |
| --- | --- | --- | --- |
| `obj` | any | — | value to test |

## Behaviour
Thin wrapper over `isinstance(obj, (list, tuple))`. Returns a plain Python bool. Note it does not
consider strings, dicts, or arbitrary iterables to be sequences.

## Examples
```python
from pymol import cmd
cmd.is_sequence([1, 2])   # True
cmd.is_sequence((1, 2))   # True
cmd.is_sequence('ab')     # False
```

## Related
[is_list](is_list.md), [is_tuple](is_tuple.md), [is_string](is_string.md)

## Source
`packages/engine/modules/pymol/checking.py:25`. Parity: not ported to engine-ts (pure Python
predicate).
