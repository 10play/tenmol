---
name: del_colorection
kind: command
category: coloring
subcategory: colorection
summary: Deletes a stored colorection (named color-by-selection snapshot) entry.
parity: implemented
---

## Purpose
`del_colorection` removes a stored "colorection" — a saved association of colors to a selection, used by PyMOL's color-storing/restoring machinery (e.g. `get_colorection`/`set_colorection`). It is a low-level helper rather than an everyday command.

## Syntax
`del_colorection(dict, key)`

| Param | Type | Default | Meaning |
| --- | --- | --- | --- |
| `dict` | dict | — | The colorection dictionary/handle |
| `key` | str | — | The key identifying the colorection to delete |

## Behaviour
Locks the session and calls the C-layer `del_colorection(dict, key)`, removing the named colorection entry. Carries no docstring in the engine; used internally by color save/restore flows.

## Examples
```text
# Used internally by colorection save/restore; not a typical prompt command.
```

## Related
- [color](../commands/color.md)

## Source
`packages/engine/modules/pymol/viewing.py:915` (`def del_colorection`). Ported: `packages/engine-ts/src/cmd/misc2.ts:102` (`ctx.command('del_colorection', ...)`).
