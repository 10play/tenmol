---
name: fb_mask
kind: command
category: control-flow-system
subcategory: feedback enums
summary: Internal enum container holding the numeric codes for feedback output categories (masks) used by the feedback command.
parity: internal
---

## Purpose
`fb_mask` is an enum-like object imported from the C layer, not an invokable command. It enumerates the output-category bits (e.g. warnings, actions, results, debugging, everything) that `feedback` toggles on or off per module.

## Syntax
Not a callable. Accessed as attributes and via the `fb_mask_sc` Shortcut.

## Behaviour
`feedback` resolves its `mask` argument through `fb_mask_sc.interpret(mask)`. Listing `fb_mask.__dict__.keys()` yields the available category names PyMOL prints when `feedback` is called with no arguments.

## Examples
```python
# consumed internally by feedback
feedback disable, selector, warnings actions
```

## Related
- [feedback](feedback.md) - the user-facing command
- [fb_action](fb_action.md), [fb_module](fb_module.md) - sibling enums

## Source
`packages/engine/modules/pymol/feedingback.py:5,32` (`fb_mask_sc = Shortcut(fb_mask.__dict__.keys())`). Parity: internal, not exposed as an engine-ts command.
