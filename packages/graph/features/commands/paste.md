---
name: paste
kind: command
category: internal
subcategory: clipboard
summary: Internal command that pastes text from the system clipboard into PyMOL.
parity: internal
---

## Purpose
`paste` is an internal command that pulls text from the host machine's clipboard
and feeds it into PyMOL. It backs the GUI paste action; end users normally reach
it through a keyboard shortcut rather than typing it.

## Syntax
```
paste()
```

_No user-facing parameters._

## Behaviour
Marked `# INTERNAL`. It calls `pymol.machine_get_clipboard()` (if that hook
exists) to fetch a list of clipboard strings, trims trailing non-printable
characters from each line, and discards the special sentinel
`PRIMARY selection doesn't exist or form "STRING" not defined`. The cleaned list
is handed to `_cmd.paste`. If nothing is available it succeeds silently. Depends
on a platform clipboard bridge being present.

## Examples
```
# invoked internally by the GUI paste handler
paste
```

## Related
- `cmd.do` - line entry that pasted text is fed into

## Source
`packages/engine/modules/pymol/externing.py:152`. Internal clipboard helper.
