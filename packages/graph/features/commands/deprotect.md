---
name: deprotect
kind: command
category: editing-building
subcategory: atom protection
summary: Clears the "protected" flag on atoms, reversing the protect command.
parity: implemented
---

## Purpose
`deprotect` reverses `protect`: it clears the protection flag so that the affected atoms are once again moved by editing/transform operations (translate, rotate, sculpting, etc.). Use it after temporarily shielding part of a structure during an edit.

## Syntax
`deprotect(selection='(all)', quiet=1)`

| Param | Type | Default | Meaning |
| --- | --- | --- | --- |
| `selection` | str | `'(all)'` | Atoms whose protection flag is cleared |
| `quiet` | int | `1` | Suppress status output when `1` |

## Behaviour
Preprocesses the selection and calls the C-layer `protect` with the clear flag (`0`), i.e. it is `protect` in reverse. With the default `(all)` it deprotects everything. Protection affects only interactive/transform editing; it does not change representation or selection membership.

## Examples
```python
deprotect
deprotect chain A
```

## Related
- [protect](../commands/protect.md)
- [mask](../commands/mask.md)
- [unmask](../commands/unmask.md)

## Source
`packages/engine/modules/pymol/editing.py:2796` (`def deprotect`). Ported: `packages/engine-ts/src/cmd/editing.ts:419` (`ctx.command('deprotect', ...)`).
