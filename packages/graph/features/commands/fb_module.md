---
name: fb_module
kind: command
category: control-flow-system
subcategory: feedback enums
summary: Internal enum container holding the numeric codes for PyMOL feedback modules (subsystems) used by the feedback command.
parity: internal
---

## Purpose
`fb_module` is an enum-like object imported from the C layer, not an invokable command. It enumerates the internal subsystems (main, selector, executive, etc.) whose message verbosity can be adjusted through `feedback`.

## Syntax
Not a callable. Accessed as attributes and via the `fb_module_sc` Shortcut.

## Behaviour
`feedback` maps its `module` argument to a module code via `fb_module_sc.interpret(module)`. The module names printed by a bare `feedback` invocation come from `fb_module.__dict__.keys()`; the loop at `feedingback.py:36` iterates these entries to build the listing.

## Examples
```python
# consumed internally by feedback
feedback enable, main, blather
```

## Related
- [feedback](feedback.md) - the user-facing command
- [fb_action](fb_action.md), [fb_mask](fb_mask.md) - sibling enums

## Source
`packages/engine/modules/pymol/feedingback.py:5,30,36`. Parity: internal, not exposed as an engine-ts command.
