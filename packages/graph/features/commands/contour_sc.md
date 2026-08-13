---
name: contour_sc
kind: command
category: internal
subcategory: shortcut helper
summary: Internal shortcut-completion helper for contour-related argument names.
parity: internal
---

## Purpose
`contour_sc` is an internal helper, not a user-facing command. It wires a `Shortcut` auto-completion object to a name table (`gnot`) so that contour-related arguments can be abbreviated and error-checked at the prompt. It carries no docstring and is not meant to be invoked directly.

## Syntax
`contour_sc(sc, gnot)`

| Param | Type | Default | Meaning |
| --- | --- | --- | --- |
| `sc` | Shortcut | `<Shortcut instance>` | Shortcut/auto-completion table |
| `gnot` | opaque | `<opaque>` | Associated name/option data |

## Behaviour
Support plumbing for shortcut expansion; behaviour is entirely internal and undocumented in the API reference. Treat it as an implementation detail of the command layer rather than a scripting entry point.

## Examples
```text
# Not intended for direct use.
```

## Related
- [config_mouse](../commands/config_mouse.md)

## Source
`docs/api-reference/commands.mdx` (`### cmd.contour_sc`). No dedicated engine docstring; no TypeScript port. Internal helper.
