---
name: publication
kind: command
category: presets
subcategory: display preset
summary: Applies a publication-quality cartoon display preset built on top of pretty.
parity: implemented
---

## Purpose
`publication` is a preset that produces a figure-ready view: it runs the `pretty`
preset and then refines cartoon settings for a polished, print-quality look
(smoothed loops, fancy helices, grey highlight edges). Use it as the final step
before rendering a paper figure.

## Syntax
```
publication(selection='(all)', *, solv=False)
```

| Param | Type | Default | Meaning |
| --- | --- | --- | --- |
| `selection` | str | `'(all)'` | atoms the preset is applied to |
| `solv` | bool | `False` | if True, also show waters/solvent (passed through to `pretty`) |

## Behaviour
First calls `pretty(selection, solv=solv)`, then overrides cartoon settings on
the resolved object: enables `cartoon_smooth_loops`, sets
`cartoon_highlight_color` to `grey50`, enables `cartoon_fancy_helices` and
`cartoon_flat_sheets`, and disables `cartoon_side_chain_helper`. `pub_no_solv` is
an alias and `pub_solv` is the `solv=True` convenience wrapper.

## Examples
```
publication
publication polymer, solv=True
```

## Related
- [pretty](pretty.md) - the base preset this extends
- `cartoon`, `set` - cartoon appearance controls

## Source
`packages/engine/modules/pymol/preset.py:330`. Registered in the TS port at
`packages/engine-ts/src/cmd/preset.ts:412`.
