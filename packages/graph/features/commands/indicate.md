---
name: indicate
kind: command
category: selecting
subcategory: visual selection
summary: Shows a transient visual overlay marking the atoms of a selection.
parity: implemented
---

## Purpose
`indicate` draws a visual overlay (the "indicate" representation) on the atoms of a selection, without disturbing your named selections. Use it to flash-highlight where a set of atoms is.

## Syntax
`indicate(selection='(all)')`

| Param | Type | Default | Meaning |
| --- | --- | --- | --- |
| `selection` | selection | `'(all)'` | Atoms to highlight |

## Behaviour
Selection is processed via `selector.process`, then a hidden selection named `indicate` is created (`_cmd.select` into `"indicate"`) and enabled so its overlay shows. If the select fails/errors the `indicate` object is deleted. Because it reuses one reserved name, calling it again replaces the previous indication.

## Examples
```python
indicate polymer and name CA
indicate byres (resn LIG around 4)
```

## Related
- [select](../commands/select.md)
- [enable](../commands/enable.md)

## Source
`packages/engine/modules/pymol/selecting.py:176`. Parity: implemented in `packages/engine-ts/src/cmd/misc.ts`.
