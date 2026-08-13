---
name: refresh_wizard
kind: command
category: wizard
subcategory: internal
summary: Internal, unsupported command that redraws the active wizard's GUI prompt/menu.
parity: internal
---

## Purpose
`refresh_wizard` forces the active wizard's interface (prompt text and menu) to be
regenerated. It is an internal, unsupported command used by wizard code after a
wizard mutates its own state; it is not intended for direct use.

## Syntax
```
refresh_wizard
```
Takes no arguments.

## Behaviour
Marked `# INTERNAL` and documented as "an unsupported internal command". Calls
`_cmd.refresh_wizard` under the command lock to rebuild the wizard panel from the
current wizard stack. In the TypeScript port it is a no-op redraw hook.

## Related
- [wizard](../commands/wizard.md)
- [refresh](../commands/refresh.md)

## Source
`packages/engine/modules/pymol/wizarding.py` (`def refresh_wizard` — INTERNAL).
Parity: registered as a no-op in `packages/engine-ts/src/cmd/wizards.ts:165`.
