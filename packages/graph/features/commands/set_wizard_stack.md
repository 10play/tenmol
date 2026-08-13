---
name: set_wizard_stack
kind: command
category: wizard
subcategory: wizard stack
summary: Internal command that replaces the entire wizard stack with a supplied list.
parity: internal
---

## Purpose
`set_wizard_stack` is an INTERNAL command that overwrites the whole stack of active wizards at once. It is used by session restore and the wizard framework to reconstitute nested wizard state, not typed by users.

## Syntax
`set_wizard_stack(stack=[])`

| Param | Type | Default | Meaning |
| --- | --- | --- | --- |
| `stack` | list | `[]` | List of wizard instances to install as the stack |

## Behaviour
Lock-guarded pass-through to `_cmd.set_wizard_stack`. The provided list becomes the complete wizard stack (bottom-to-top), replacing whatever was present. An empty list clears all wizards. Marked `# INTERNAL`.

## Examples
```python
cmd.set_wizard_stack([])   # clear all active wizards
```

## Related
- [set_wizard](./set_wizard.md)
- [wizard](./wizard.md)

## Source
`packages/engine/modules/pymol/wizarding.py:120`; signature in `docs/api-reference/commands.mdx:3766`. Parity: internal — wizard plumbing in `packages/engine-ts/src/cmd/wizards.ts`.
