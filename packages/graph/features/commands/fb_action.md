---
name: fb_action
kind: command
category: control-flow-system
subcategory: feedback enums
summary: Internal enum container holding the numeric codes for feedback actions (set/enable/disable) used by the feedback command.
parity: internal
---

## Purpose
`fb_action` is not an invokable command but an enum-like object imported from the C layer (`from .cmd import fb_action`). It holds the numeric action codes (set, enable, disable) that `feedback` interprets to change output verbosity.

## Syntax
Not a callable. Accessed as attributes, e.g. `fb_action.set`, and via the `fb_action_sc` Shortcut for name interpretation.

## Behaviour
`feedback` looks up its `action` argument against `fb_action` (`fb_action_sc.interpret(action)`) then reads the integer with `getattr(fb_action, key)`. End users normally never touch this object directly.

## Examples
```python
# consumed internally by feedback; not called directly
feedback enable, all, debugging
```

## Related
- [feedback](feedback.md) - the user-facing command
- [fb_module](fb_module.md), [fb_mask](fb_mask.md) - sibling enums

## Source
`packages/engine/modules/pymol/feedingback.py:5` (`from .cmd import fb_module, fb_mask, fb_action`). Parity: internal, not exposed as an engine-ts command.
