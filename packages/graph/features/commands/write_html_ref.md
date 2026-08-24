---
name: write_html_ref
kind: command
category: control-flow-system
subcategory: documentation
summary: Writes the PyMOL command reference to an HTML file.
parity: implemented
---

## Purpose
`write_html_ref` is a developer/documentation utility that dumps PyMOL's entire
command keyword reference to a standalone HTML file. Reach for it to generate an
offline command index straight from the running interpreter's registered
keywords.

## Syntax
`write_html_ref(file)`

| Param | Type | Default | Meaning |
| --- | --- | --- | --- |
| `file` | string | (required) | Path of the HTML file to write. |

## Behaviour
Opens `file` for writing, collects command keywords from
`keywords.get_command_keywords()`, filtering out underscore-prefixed names and
any entry whose help handler is `python_help`, and sorts them. It then writes an
HTML document titled "PyMOL Command Reference" with an inline stylesheet
(sans-serif body, floated `10em`-wide list items, grey monospace API lines and
example blocks) and a section per command. There are no options beyond the output
path; the command is defined inside `cmd.py` module setup rather than in a
topical command module.

## Examples
```
write_html_ref /tmp/pymol_commands.html
```

## Related
- [api](../commands/api.md)
- [help](../commands/help.md)

## Source
`packages/engine/modules/pymol/cmd.py:211`. Parity: `packages/engine-ts/src/cmd/extras.ts`
registers `write_html_ref` as a None no-op — it writes an HTML reference page to disk, which
headless (no filesystem) does nothing and returns `None`, matching the real-PyMOL GL oracle
(verified — `packages/graph/verify/probes/command__write_html_ref.json`).
