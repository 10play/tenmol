---
name: wizard
kind: command
category: wizard
subcategory: wizard stack
summary: Launches one of PyMOL's built-in interactive wizards.
parity: implemented
---

## Purpose
`wizard` activates a built-in wizard — a Python helper that drives multi-step
interactive tasks (measuring distances, mutagenesis, appearance tweaks, etc.)
through the on-screen panel and prompt. Reach for it to enter a guided mode; call
it with no name to dismiss the active wizard.

## Syntax
`wizard(name=None, *arg, **kwd)`

| Param | Type | Default | Meaning |
| --- | --- | --- | --- |
| `name` | string | `None` | Wizard to launch; `None` clears the active wizard. Extra positional/keyword args are forwarded to the wizard constructor. |

## Behaviour
With `name=None` the command calls `set_wizard()`, popping/clearing the active
wizard. Otherwise the name is stringified and, for legacy compatibility,
`'distance'` is silently rewritten to `'measurement'` before the wizard is
instantiated and pushed onto the wizard stack via the internal `_wizard(...)`
helper (with `replace=0`). Any surplus positional args (`*arg`) and keyword args
(`**kwd`) are passed through to the wizard's constructor. The related
`replace_wizard` swaps the top wizard in place instead of stacking. Built-in
names include `appearance`, `measurement`, `mutagenesis`, `nucmutagenesis`,
`pair_fit`, `density`, `filter`, `sculpting`, `label`, `charge`, and `demo`.

## Examples
```
wizard distance     # legacy alias -> launches the measurement wizard
wizard mutagenesis
wizard              # dismiss the active wizard
```

## Related
- [set_wizard](../commands/set_wizard.md)
- [replace_wizard](../commands/replace_wizard.md)
- [refresh_wizard](../commands/refresh_wizard.md)

## Source
`packages/engine/modules/pymol/wizarding.py:62`. Parity: implemented — ported in
`packages/engine-ts/src/cmd/wizards.ts` (`registerWizards`, the `wizard`
command) as a serialisable wizard-stack record; the generic wizard protocol is a
completed area (8) in `docs/feature-parity.md`, though heavyweight per-wizard
interaction (atom picking, sculpting) is out of scope for the port.
