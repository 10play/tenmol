---
name: safe_alpha_list_eval
kind: command
category: internal
subcategory: safe evaluation
summary: Safely evaluates a string like safe_eval but first strips most non-alphanumeric characters.
parity: internal
---

## Purpose
`safe_alpha_list_eval` is an internal helper that parses a bracketed list/tuple literal into Python values while sanitising input. It is used where PyMOL must turn user-supplied text into a list but wants to reject stray punctuation and code.

## Syntax
`safe_alpha_list_eval(st)`

| Param | Type | Default | Meaning |
| --- | --- | --- | --- |
| `st` | string | — | text to sanitise and evaluate |

## Behaviour
It runs a regex that removes everything except letters, digits, `_ ' " . - [ ] ,` and then delegates to [safe_list_eval](../commands/safe_list_eval.md) (an alias of [safe_eval](../commands/safe_eval.md)). Because bare names evaluate to strings (via `SafeEvalNS`) and callables are unreachable, no harmful code can execute. Example from the docstring: `safe_alpha_list_eval("[A B/C, D+E:F]")` returns `['ABC', 'DEF']`.

## Examples
```python
safe_alpha_list_eval("[A B/C, D+E:F]")   # -> ['ABC', 'DEF']
```

## Related
- [safe_eval](../commands/safe_eval.md)
- [safe_list_eval](../commands/safe_list_eval.md)

## Source
`packages/engine/modules/pymol/constants.py:93`; signature in `docs/api-reference/commands.mdx:3340`. Parity: internal parsing helper; not ported to `packages/engine-ts/src`.
