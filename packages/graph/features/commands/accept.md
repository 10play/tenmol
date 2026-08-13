---
name: accept
kind: command
category: file-io
subcategory: session security
summary: Internal handler that approves potentially unsafe content in a loading session file.
parity: implemented
---

## Purpose
`accept` is an internal method for session-file security handling. When a session (`.pse`/`.psw`) contains embedded Python or other content that PyMOL considers a security risk, the load pauses behind a security wizard; `accept` is the affirmative response that lets the content proceed. Its counterpart is `decline`.

## Syntax
`accept()` — takes no arguments.

## Behaviour
It acquires the API lock, calls `_cmd.accept` on the core object, then clears the active wizard via `set_wizard()`. On failure it returns `DEFAULT_ERROR` and raises `pymol.CmdException` when raising is enabled. It is not intended for direct interactive use — it exists to be triggered by the security-prompt UI flow.

## Examples
```python
# invoked by the session-security wizard, not typically typed by hand
cmd.accept()
```

## Related
- [backward](./backward.md)

## Source
`packages/engine/modules/pymol/moving.py:29`. Parity: implemented (stub-level) in `packages/engine-ts/src/cmd/controlflow.ts`.
