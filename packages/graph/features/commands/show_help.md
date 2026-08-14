---
name: show_help
kind: command
category: control-flow-system
subcategory: help
summary: Internal helper that prints help text for a command keyword (backs the "help" command).
parity: internal
---

## Purpose
`show_help` is an INTERNAL routine that prints the documentation for a named command. It is invoked by the user-facing `help` verb rather than called directly.

## Syntax
`show_help(cmmd)`

| Param | Type | Default | Meaning |
| --- | --- | --- | --- |
| `cmmd` | string | — | The command/keyword to display help for |

## Behaviour
Echoes `PyMOL>help <cmmd>`, then calls Python's `help(cmmd)` to emit the docstring. If the `internal_feedback` setting is greater than 0 it additionally prints "(Hit ESC to hide)". Marked `# INTERNAL`; output routing is tied to PyMOL's feedback system.

## Examples
```python
help color        # front-end routes to show_help('color')
```

## Related
- [help](./help.md)
- [api](./api.md)

## Source
`packages/engine/modules/pymol/helping.py` (`def show_help`); signature in `docs/api-reference/commands.mdx:3794`. Parity: internal — help routing handled in `packages/engine-ts/src/cmd/topics.ts`.
