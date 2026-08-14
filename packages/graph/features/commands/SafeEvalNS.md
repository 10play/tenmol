---
name: SafeEvalNS
kind: command
category: control-flow-system
subcategory: safe evaluation
summary: Namespace object that makes eval() resolve any bare name to its own string.
parity: internal
---

## Purpose
`SafeEvalNS` is a tiny helper class backing `safe_eval` — a hardened version of Python `eval` used when parsing command arguments that may contain unquoted identifiers. It lets expressions like `red` or `chain A` evaluate to strings instead of raising `NameError`, while blocking callable/attribute exploits.

## Syntax
`SafeEvalNS()` — used as the locals mapping: `eval(st, {}, SafeEvalNS())`.

## Behaviour
Its only method is `__getitem__(self, name)`, which returns `name` verbatim. Because it is passed as the `locals` dict to `eval` with empty `globals`, every bare identifier resolves to its own string value, numeric/list/dict literals evaluate normally, and any attempt to call or import (e.g. `__import__("os").unlink(...)`) fails with `TypeError: 'str' object is not callable`. This is the mechanism that makes command-line arguments both convenient (unquoted names) and safe.

## Examples
```python
safe_eval('foo, 123, 4 + 5, "A B C"')   # -> ('foo', 123, 9, 'A B C')
safe_eval('__import__("os").unlink("x")')  # -> TypeError, no code runs
```

## Related
- [Shortcut](./Shortcut.md)

## Source
`packages/engine/modules/pymol/constants.py:102`. Parity: internal — argument coercion in the TypeScript port is handled by its own parser, not a Python `eval` sandbox.
