---
name: is_string
kind: command
category: internal
subcategory: type predicate
summary: Return True if the given object is a string (str or bytes).
parity: internal
---

## Purpose
Internal type-checking helper used pervasively by command wrappers to decide whether an argument
is a text value (as opposed to a numeric or container value) before coercing or forwarding it.

## Syntax
`is_string(obj)`

| Param | Type | Default | Meaning |
| --- | --- | --- | --- |
| `obj` | any | — | value to test |

## Behaviour
Wrapper over `isinstance(obj, basestring)`, where `basestring` is aliased to `(str, bytes)` on
Python 3. Thus both `str` and `bytes` return True. No side effects.

## Examples
```python
from pymol import cmd
cmd.is_string('resi 5')   # True
cmd.is_string(b'abc')     # True
cmd.is_string(5)          # False
```

## Related
[is_sequence](is_sequence.md), [is_list](is_list.md)

## Source
`packages/engine/modules/pymol/checking.py:13`. Parity: not ported to engine-ts (pure Python
predicate).
