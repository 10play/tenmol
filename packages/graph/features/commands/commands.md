---
name: commands
kind: command
category: control-flow-system
subcategory: help
summary: Prints a categorised cheat-sheet of PyMOL's most common commands.
parity: implemented
---

## Purpose
`commands` prints a compact, categorised listing of PyMOL's most frequently used commands (input/output, view, movies, imaging, ray tracing, maps, editing, fitting, colours, etc.). Reach for it at the interactive prompt as a quick reminder of what exists; follow up with `help <command-name>` for detail.

## Syntax
`commands()`

Takes no arguments.

## Behaviour
Emits a fixed, human-readable text block grouped by task area (INPUT/OUTPUT, VIEW, MOVIES, IMAGING, RAY TRACING, MAPS, DISPLAY, SELECTIONS, SETTINGS, ATOMS, EDITING, FITTING, COLORS, HELP, DISTANCES, STEREO, SYMMETRY, SCRIPTS, LANGUAGE). It also points at extra help topics such as `"api"`, `"editing"`, `"selections"`, `"movies"`, and `"@"`. Purely informational, has no side effects on the session, and returns nothing meaningful.

## Examples
```python
commands
```

## Related
- [help](../commands/help.md)

## Source
`packages/engine/modules/pymol/helping.py:101` (`def commands`). Ported: the static text is provided in `packages/engine-ts/src/cmd/topics.ts:89` (`ctx.command('commands', () => COMMANDS_TEXT)`).
