---
name: set_key
kind: command
category: control-flow-system
subcategory: key bindings
summary: Binds a Python function or a PyMOL command string to a function/modifier key press.
parity: implemented
---

## Purpose
`set_key` (API-only) attaches an action to a keyboard key so pressing it runs a callback or a command. Use it to build custom hotkeys — e.g. bind F1 to a favourite representation change, or CTRL-C to zoom.

## Syntax
`set_key(key, fn=None, arg=(), kw={})`

| Param | Type | Default | Meaning |
| --- | --- | --- | --- |
| `key` | str | — | key name, optionally with a modifier prefix (e.g. `F1`, `CTRL-C`, `ALT-A`) |
| `fn` | callable/str | `None` | Python function to call, or (since 1.6.1) a PyMOL command string |
| `arg` | tuple | `()` | positional args passed to `fn` |
| `kw` | dict | `{}` | keyword args passed to `fn` |

## Behaviour
Since PyMOL 1.6.1 the second argument may be a command string in PyMOL syntax (e.g. `"as cartoon, polymer; as sticks, organic"`); in that case `arg`/`kw` must be empty. When `fn` is omitted, `set_key` acts as a decorator. Bindable keys: F1–F12; left, right, pgup, pgdn, home, insert; CTRL-A to CTRL-Z; ALT-0 to ALT-9 and ALT-A to ALT-Z. The modifier is parsed from the prefix before the final `-`.

## Examples
```python
set_key F1, as cartoon, polymer; as sticks, organic
cmd.set_key('CTRL-C', cmd.zoom)
cmd.set_key('ALT-A', cmd.turn, ('x', 90))
```

## Related
- [button](button.md) — bind mouse actions
- [alias](alias.md) — name a command sequence

## Source
Upstream: `packages/engine/modules/pymol/controlling.py:719`. Parity: implemented at `packages/engine-ts/src/cmd/controlflow.ts:213`.
