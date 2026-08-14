---
name: help_setting
kind: command
category: settings
subcategory: documentation
summary: Prints documentation for a named setting.
parity: partial
---

## Purpose
`help_setting` prints the documentation for a given setting by name. Use it to look up what a setting controls and its expected values.

## Syntax
`help_setting(name, quiet=1)`

| Param | Type | Default | Meaning |
| --- | --- | --- | --- |
| `name` | string | — | Setting name to document |
| `quiet` | 0/1 | `1` | Suppress feedback when `1` |

## Behaviour
In the open-source engine this command raises `pymol.IncentiveOnlyException()` — its documentation database ships only with Incentive PyMOL. The TypeScript port supplies its own static help text instead.

## Examples
```python
help_setting cartoon_transparency
```

## Related
- [help](./help.md)
- [set](../commands/set.md)

## Source
`packages/engine/modules/pymol/helping.py:89`. Parity: partial — the incentive-only Python raises; `packages/engine-ts/src/cmd/topics.ts` returns static `HELP_SETTING_TEXT`.
