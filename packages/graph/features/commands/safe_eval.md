---
name: safe_eval
kind: command
category: internal
subcategory: safe evaluation
summary: A sandboxed eval that evaluates bare names to strings and blocks harmful code.
parity: internal
---

## Purpose
`safe_eval` is an internal helper providing a safe alternative to Python's `eval`: it parses literal expressions but resolves any bare identifier to its own name as a string, so untrusted input cannot reach real objects or callables. PyMOL uses it to turn command-line argument text into Python values.

## Syntax
`safe_eval(st)`

| Param | Type | Default | Meaning |
| --- | --- | --- | --- |
| `st` | string | — | expression text to evaluate |

## Behaviour
Implemented as `eval(st, {}, SafeEvalNS())`, where `SafeEvalNS.__getitem__` returns the looked-up name itself. Thus `safe_eval('foo, 123, 4 + 5, "A B C", {}, "{}"')` yields `('foo', 123, 9, 'A B C', {}, '{}')` — numbers and string literals evaluate normally, bare words become strings. Attempts like `__import__("os").unlink(...)` fail because the resolved name is a plain string and not callable. `safe_list_eval` is a direct alias of this function.

## Examples
```python
safe_eval('foo, 123, 4 + 5, "A B C"')   # -> ('foo', 123, 9, 'A B C')
```

## Related
- [safe_list_eval](../commands/safe_list_eval.md)
- [safe_alpha_list_eval](../commands/safe_alpha_list_eval.md)

## Source
`packages/engine/modules/pymol/constants.py:106`; signature in `docs/api-reference/commands.mdx:3346`. Parity: internal parsing helper; not ported to `packages/engine-ts/src`.
