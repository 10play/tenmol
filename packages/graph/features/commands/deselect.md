---
name: deselect
kind: command
category: selecting
subcategory: selection visibility
summary: Disables (hides) all currently visible named selections.
parity: unknown
---

## Purpose
`deselect` disables every visible/enabled named selection, clearing the pink selection dots from the display. Use it to tidy the view after selecting without deleting the selections themselves.

## Syntax
`deselect()`

Takes no arguments.

## Behaviour
Enumerates the enabled named selections (`get_names('selections', enabled_only=1)`) and calls `disable` on each. The selections still exist and can be re-enabled; only their visible indicator is turned off. Does not affect object visibility or the atoms themselves.

## Examples
```python
deselect
```

## Related
- [select](../commands/select.md)
- [disable](../commands/disable.md)

## Source
`packages/engine/modules/pymol/selecting.py:27` (`def deselect`). No confirmed TypeScript command registration found in `packages/engine-ts/src`; parity unverified.
