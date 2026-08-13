---
name: feedback
kind: command
category: control-flow-system
subcategory: logging verbosity
summary: Adjusts how much diagnostic output PyMOL prints, per subsystem module and per output category.
parity: unknown
---

## Purpose
`feedback` changes the amount of information PyMOL emits to the console. You reach for it to silence noisy warnings, or to enable debugging/blather output from a specific internal module while chasing a problem.

## Syntax
`feedback(action='?', module='?', mask='?')`

| Param | Type | Default | Meaning |
| --- | --- | --- | --- |
| `action` | str | `'?'` | `set`, `enable`, or `disable` |
| `module` | str | `'?'` | space-separated list of modules, or `all` |
| `mask` | str | `'?'` | space-separated list of output categories, or `everything` |

## Behaviour
The `module` and `mask` arguments are resolved against the [fb_module](fb_module.md) and [fb_mask](fb_mask.md) enums (via Shortcut interpretation), and `action` against [fb_action](fb_action.md). Calling `feedback` with no arguments prints the list of available module choices. `enable`/`disable` turn the category bits on/off for the named modules; `set` assigns them directly.

## Examples
```python
feedback enable, all, debugging
feedback disable, selector, warnings actions
feedback enable, main, blather
```

## Related
- [fb_action](fb_action.md), [fb_module](fb_module.md), [fb_mask](fb_mask.md) - the backing enums

## Source
`packages/engine/modules/pymol/feedingback.py` (`def feedback`). Parity: not registered as an engine-ts command.
