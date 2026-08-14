---
name: get_wizard
kind: command
category: wizard
subcategory: wizard stack
summary: Return the active (topmost) wizard instance, or None if no wizard is active.
parity: implemented
---

## Purpose
`get_wizard` returns the currently active wizard object — the one on top of the
wizard stack. Wizards use it to reach their own instance from callbacks, and
scripts use it to detect or drive an active wizard.

## Syntax
`get_wizard()`

Takes no arguments.

## Behaviour
Returns the topmost wizard instance, or `None` if the stack is empty. Marked
`# INTERNAL`; it acquires the API lock and raises `CmdException` on error. To
inspect the whole stack rather than just the top, use `get_wizard_stack`.

## Examples
```python
wiz = cmd.get_wizard()
if wiz is not None:
    wiz.cleanup()
```

## Related
- [get_wizard_stack](get_wizard_stack.md), [wizard](wizard.md), [set_wizard](set_wizard.md), [refresh_wizard](refresh_wizard.md)

## Source
`packages/engine/modules/pymol/wizarding.py:156`. Parity: implemented — wizard
support lives in `packages/engine-ts/src/cmd/wizards.ts`.
