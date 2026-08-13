---
name: color_deep
kind: command
category: coloring
subcategory: atom/object color
summary: Clears all object/atom-level color settings, then applies one color.
parity: implemented
---

## Purpose
`color_deep` forces a uniform color by first removing every object- and
atom-level color override (per-representation colors such as
`cartoon_color`, `surface_color`, `stick_color`, etc.) and then applying the
given color. Reach for it when a plain `color` leaves parts of an object tinted
by representation-specific color settings.

## Syntax
`color_deep(color, name='all', quiet=1)`

| Param | Type | Default | Meaning |
| --- | --- | --- | --- |
| `color` | str | — | Color name or number to apply. |
| `name` | str | `'all'` | Object name or pattern to affect. |
| `quiet` | int | `1` | Suppress feedback when set. |

## Behaviour
It gathers the representation color settings from `pymol.menu.rep_setting_lists`
and calls `unset_deep` on them for the matching objects (with `updates=0`), which
strips global-exempt per-object and per-atom color settings, and then calls
`color(color, name)`. Only color-related settings are unset — other settings are
untouched. This does not clear the global default color, only object/atom-level
overrides.

## Examples
```
color_deep grey80
color_deep marine, myprotein
```

## Related
- [color](../commands/color.md)
- [unset_deep](../commands/unset_deep.md)

## Source
`packages/engine/modules/pymol/viewing.py:1948`. Ported in
`packages/engine-ts/src/cmd/util2.ts` (`color_deep`).
