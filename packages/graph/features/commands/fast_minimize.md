---
name: fast_minimize
kind: command
category: sculpting-minimization
subcategory: minimization
summary: Unsupported, nonfunctional placeholder that may eventually perform a quick structure clean-up.
parity: internal
---

## Purpose
`fast_minimize` is a stub. Upstream describes it as "an unsupported nonfunctional command that may eventually have something to do with doing a quick clean up of the molecular structure." It performs no useful work today.

## Syntax
`fast_minimize(*args, **kwargs)`

It accepts arbitrary arguments and ignores them.

## Behaviour
Calling it does nothing meaningful. For real geometry clean-up use the sculpting or clean workflow instead.

## Examples
```python
# no functional example - command is a placeholder
fast_minimize
```

## Related
- [fix_chemistry](fix_chemistry.md) - another unsupported placeholder

## Source
`packages/engine/modules/pymol/experimenting.py` (`def fast_minimize`). Parity: not ported (internal/nonfunctional).
