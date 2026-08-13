---
name: is_error
kind: command
category: internal
subcategory: status predicate
summary: Return True if a command result code represents an error (a negative integer).
parity: internal
---

## Purpose
Internal helper for interpreting the integer status codes returned by low-level `_cmd` calls.
PyMOL's C layer signals failure with negative return codes, and `is_error` centralises that
convention so callers can test outcomes uniformly.

## Syntax
`is_error(result)`

| Param | Type | Default | Meaning |
| --- | --- | --- | --- |
| `result` | any | — | a command return value to classify |

## Behaviour
If `result` is an `int`, returns `result < 0`. For any non-int value (strings, lists, None, etc.)
it returns `0` (i.e. not an error). This means only integer negative codes are treated as errors;
a data-bearing return is never an error by this test. It is the exact complement of
[is_ok](is_ok.md).

## Examples
```python
from pymol import cmd
cmd.is_error(-1)          # True
cmd.is_error(0)           # False
cmd.is_error(['data'])    # 0 (not an error)
```

## Related
[is_ok](is_ok.md)

## Source
`packages/engine/modules/pymol/checking.py:28`. Parity: not ported to engine-ts (Python status
convention; the TS engine reports errors via exceptions/Json).
