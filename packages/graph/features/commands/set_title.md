---
name: set_title
kind: command
category: movies-scenes-states
subcategory: states
summary: Attaches a text label to a particular state of an object, shown next to the object name when that state is active.
parity: unknown
---

## Purpose
`set_title` associates a per-state text string with an object; the string is displayed beside the object name in the panel when that state is the active one. It is commonly used to show per-conformer annotations such as energies across an ensemble.

## Syntax
`set_title(object, state, text)`

| Param | Type | Default | Meaning |
| --- | --- | --- | --- |
| `object` | string | — | Object name |
| `state` | int | — | 1-based state the title applies to |
| `text` | string | — | Title text |

## Behaviour
Lock-guarded; the wrapper decrements `state` by one (1-based to 0-based) and casts `text` to a string before dispatching to `_cmd.set_title`. The title is state-specific — set a title per state to label each conformer of a multi-state object.

## Examples
```python
set_title conformers, 1, "E = -1234.5 kcal/mol"
set_title conformers, 2, "E = -1230.1 kcal/mol"
```

## Related
- [get_title](./get_title.md)
- [set_state_order](./set_state_order.md)

## Source
`packages/engine/modules/pymol/editing.py:2194`; signature in `docs/api-reference/commands.mdx:3730`. Parity: not located in the TypeScript port — unknown.
