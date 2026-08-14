---
name: set_wizard
kind: command
category: wizard
subcategory: wizard stack
summary: Internal command that installs a wizard instance as the active wizard, optionally replacing the current one.
parity: internal
---

## Purpose
`set_wizard` is an INTERNAL command used by the wizard framework to make a given wizard object the active one. It is called by `wizard` and by wizard implementations rather than typed directly by users.

## Syntax
`set_wizard(wizard=None, replace=0)`

| Param | Type | Default | Meaning |
| --- | --- | --- | --- |
| `wizard` | object | `None` | Wizard instance to activate; `None` clears |
| `replace` | int | `0` | If set, replace the top of the wizard stack instead of pushing |

## Behaviour
Lock-guarded pass-through to `_cmd.set_wizard`. With `replace=0` the wizard is pushed onto the wizard stack; with `replace=1` it replaces the current top entry. Passing `None` deactivates the active wizard. Marked `# INTERNAL` in the source and not part of the supported public API.

## Examples
```python
import pymol.wizard.measurement as m
cmd.set_wizard(m.Measurement())
```

## Related
- [set_wizard_stack](./set_wizard_stack.md)
- [wizard](./wizard.md)
- [refresh_wizard](./refresh_wizard.md)

## Source
`packages/engine/modules/pymol/wizarding.py:110`; signature in `docs/api-reference/commands.mdx:3759`. Parity: internal — wizard plumbing in `packages/engine-ts/src/cmd/wizards.ts`.
