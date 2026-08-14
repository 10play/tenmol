---
name: get_wizard_stack
kind: command
category: wizard
subcategory: wizard state
summary: Returns the internal stack of active wizard objects.
parity: internal
---

## Purpose
`get_wizard_stack` returns the list of currently-active wizard objects, innermost last. It is an INTERNAL accessor used by session save/restore and by wizard-management code rather than something you call at the command line.

## Syntax
`get_wizard_stack()`

This command takes no user arguments (only the internal `_self` handle).

## Behaviour
Locks the C layer and calls `_cmd.get_wizard_stack`, returning the wizard stack as a Python list. It underpins `session_save_wizard`, which double-pickles the returned stack so the session file is class-independent. Marked `# INTERNAL` in the source; not intended for direct scripting use.

## Examples
```python
stack = cmd.get_wizard_stack()
```

## Related
- [get_wizard](../commands/get_wizard.md)
- [wizard](../commands/wizard.md)

## Source
`packages/engine/modules/pymol/wizarding.py:166`. Parity: present as an internal helper in `packages/engine-ts/src/cmd/wizards.ts`.
