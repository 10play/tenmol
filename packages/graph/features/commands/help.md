---
name: help
kind: command
category: control-flow-system
subcategory: documentation
summary: Prints the online help (docstring) for a given command or topic.
parity: partial
---

## Purpose
`help` prints the built-in documentation for a command or help topic to the feedback log. Use it at the interactive prompt to recall a command's usage without leaving PyMOL.

## Syntax
`help(command='commands')`

| Param | Type | Default | Meaning |
| --- | --- | --- | --- |
| `command` | string | `'commands'` | Command or topic name to look up |

## Behaviour
The argument is resolved through the `help_sc` shortcut, so abbreviations complete. If it matches a registered keyword its docstring is printed (dedented and stripped); if it matches a help-only topic that text is printed; otherwise `Error: unrecognized command` is shown. The default topic `commands` prints the categorized command index. If the resolved entry has no docstring, `Error: sorry no help available on that command.` is printed.

## Examples
```python
help
help load
```

## Related
- [help_setting](./help_setting.md)

## Source
`packages/engine/modules/pymol/helping.py:62`. Parity: partial — registered in `packages/engine-ts/src/cmd/system.ts` as a no-op stub (`ctx.command('help', () => null)`).
