---
name: editing_ring
kind: command
category: editing-building
subcategory: clipboard
summary: Helper for copy/cut/paste/invert of the active molecular selection.
parity: internal
---

## Purpose
`editing_ring` is a keyboard/menu helper that implements clipboard-style operations (cut, copy, paste, invert) on the currently active public selection. It backs the editor's copy/paste keybindings rather than being a routine scripting verb.

## Syntax
`editing_ring(action)`

| Param | Type | Default | Meaning |
| --- | --- | --- | --- |
| `action` | str | — | One of `cut`, `copy`, `paste`, `invert` |

## Behaviour
It keeps a persistent per-session clipboard object (`_editing_ring_space`). `paste` copies the hidden clipboard object into a new uniquely-named object (or prints "Nothing on clipboard"). The other actions operate on the first enabled public selection (printing "No active selection" if none): `copy`/`cut` stash that selection's atoms onto the clipboard (cut additionally removing them), and `invert` inverts the selection. It is invoked through key bindings, not typically typed.

## Examples
```python
cmd.editing_ring("copy")
cmd.editing_ring("paste")
```

## Related
- [copy](../commands/copy.md)
- [remove](../commands/remove.md)
- [edit](./edit.md)

## Source
`packages/engine/modules/pymol/keyboard.py:38`. Parity: implemented as a static text stub in `packages/engine-ts/src/cmd/topics.ts`.
