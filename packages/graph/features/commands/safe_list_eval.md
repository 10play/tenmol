---
name: safe_list_eval
kind: command
category: internal
subcategory: safe evaluation
summary: Alias of safe_eval used to parse list/tuple literals safely into Python values.
parity: internal
---

## Purpose
`safe_list_eval` is an internal helper for safely evaluating a list or tuple literal from user text. It is a direct alias of [safe_eval](../commands/safe_eval.md) and shares its sandboxing semantics; it is referenced by argument parsers such as the axis handling in [rotate](../commands/rotate.md).

## Syntax
`safe_list_eval(st)`

| Param | Type | Default | Meaning |
| --- | --- | --- | --- |
| `st` | string | — | list/tuple text to evaluate |

## Behaviour
Because `safe_list_eval = safe_eval`, calling it evaluates the string with the restricted `SafeEvalNS` namespace: bare names resolve to strings, literals evaluate normally, and no callables are reachable, so no harmful code can run. Typical use is parsing an `[x, y, z]` vector argument into a Python list.

## Examples
```python
safe_list_eval("[1.0, 1.0, 1.0]")   # -> [1.0, 1.0, 1.0]
```

## Related
- [safe_eval](../commands/safe_eval.md)
- [safe_alpha_list_eval](../commands/safe_alpha_list_eval.md)
- [rotate](../commands/rotate.md)

## Source
`packages/engine/modules/pymol/constants.py:120` (`safe_list_eval = safe_eval`); signature in `docs/api-reference/commands.mdx:3352`. Parity: internal parsing helper; not ported to `packages/engine-ts/src`.
