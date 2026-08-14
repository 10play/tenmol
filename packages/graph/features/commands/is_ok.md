---
name: is_ok
kind: command
category: internal
subcategory: status predicate
summary: Return True if a command result code does not represent an error.
parity: internal
---

## Purpose
Internal helper, the logical complement of [is_error](is_error.md), for testing whether a
low-level command returned successfully. Used by wrappers that want to proceed only on success.

## Syntax
`is_ok(result)`

| Param | Type | Default | Meaning |
| --- | --- | --- | --- |
| `result` | any | — | a command return value to classify |

## Behaviour
Returns `not is_error(result)`. Since `is_error` only flags negative integers, any non-negative
int or any non-int value (data payloads, strings, None) is considered OK.

## Examples
```python
from pymol import cmd
cmd.is_ok(0)          # True
cmd.is_ok(-1)         # False
cmd.is_ok(['data'])   # True
```

## Related
[is_error](is_error.md)

## Source
`packages/engine/modules/pymol/checking.py:33`. Parity: not ported to engine-ts (Python status
convention).
