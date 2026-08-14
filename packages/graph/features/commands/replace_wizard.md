---
name: replace_wizard
kind: command
category: wizard
subcategory: internal
summary: Unsupported internal helper that launches (or clears) a wizard, replacing the current one.
parity: internal
---

## Purpose
`replace_wizard` is an unsupported internal command that activates a named wizard in "replace" mode, swapping out any wizard currently on the stack. It is not intended for direct end-user use; the public entry point is [wizard](../commands/wizard.md).

## Syntax
`replace_wizard(name=None, *arg, **kwd)`

| Param | Type | Default | Meaning |
| --- | --- | --- | --- |
| `name` | string | `None` | wizard to launch; `None` clears the current wizard |
| `*arg` / `**kwd` | — | — | forwarded to the wizard constructor |

## Behaviour
When `name` is `None`, the command calls `set_wizard()` to clear the active wizard. Otherwise it invokes the internal `_wizard(name, arg, kwd, replace=1)` path, which pushes the new wizard while replacing the top of the wizard stack rather than stacking on top of it. Used internally by features such as scene messages.

## Related
- [wizard](../commands/wizard.md)
- [scene_recall_message](../commands/scene_recall_message.md)

## Source
`packages/engine/modules/pymol/wizarding.py:94`; signature in `docs/api-reference/commands.mdx:3251`. Parity: internal wizard-stack helper; not ported to `packages/engine-ts/src`.
