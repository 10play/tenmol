---
name: decline
kind: command
category: control-flow-system
subcategory: session security
summary: Internal method that declines a session-file security prompt.
parity: internal
---

## Purpose
`decline` is an internal method for handling session-file security. When a session asks the user to accept or decline potentially unsafe embedded content (e.g. Python callbacks), `decline` is the "no" response. It is not a general scripting command.

## Syntax
`decline()`

Takes no arguments.

## Behaviour
Locks the session, invokes the C-layer `decline`, then clears any active wizard via `set_wizard()`. This is the counterpart to accepting a session's security prompt; it aborts the pending accept and dismisses the associated wizard UI.

## Examples
```text
# Invoked by the session-security UI, not typically by the user.
```

## Related
- [set_wizard](../commands/set_wizard.md)

## Source
`packages/engine/modules/pymol/moving.py:48` (`def decline`). Referenced in `packages/engine-ts/src/cmd/extras.ts`. Internal session-security helper.
