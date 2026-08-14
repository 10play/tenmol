---
name: dirty_wizard
kind: command
category: internal
subcategory: wizard refresh
summary: Internal helper that marks the active wizard's panel for redraw.
parity: internal
---

## Purpose
`dirty_wizard` is an INTERNAL routine that flags the current wizard so its control panel / prompt is rebuilt on the next refresh. It is used by wizard implementations, not by end users.

## Syntax
`dirty_wizard()`

This command takes no user-facing arguments.

## Behaviour
Locks the API and calls `_cmd.dirty_wizard`, which invalidates the cached wizard UI so the executive re-queries its prompt, buttons and panel content. It raises `CmdException` on error when raising is enabled.

## Examples
```python
dirty_wizard   # invalidate the active wizard's panel (internal use)
```

## Related
- [wizard](../commands/wizard.md)
- [dirty](./dirty.md)
- [refresh_wizard](../commands/refresh_wizard.md)

## Source
`packages/engine/modules/pymol/wizarding.py:146` (marked `# INTERNAL`). Parity: implemented as a republish stub in `packages/engine-ts/src/cmd/misc2.ts`.
