---
name: dirty
kind: command
category: internal
subcategory: refresh signal
summary: Marks the scene as needing a redraw/rebuild; a low-level (largely obsolete) refresh hint.
parity: implemented
---

## Purpose
`dirty` flags the internal state so the next update pass rebuilds and redraws affected geometry. It is a low-level maintenance hook, marked `# OBSOLETE?` in the source, rarely called directly from user scripts.

## Syntax
`dirty()`

This command takes no user-facing arguments.

## Behaviour
Acquires the API lock and calls `_cmd.dirty`, which sets internal dirty flags so the executive re-derives representations on the next refresh. There is no return payload beyond the status code. In practice the modern rebuild/refresh machinery supersedes it, hence the obsolete annotation.

## Examples
```python
dirty   # force a rebuild/redraw on the next update cycle
```

## Related
- [rebuild](../commands/rebuild.md)
- [refresh](../commands/refresh.md)
- [dirty_wizard](./dirty_wizard.md)

## Source
`packages/engine/modules/pymol/viewing.py:1795`. Parity: implemented as a republish signal in `packages/engine-ts/src/cmd/misc2.ts`.
