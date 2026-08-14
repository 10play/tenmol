---
name: group_sc
kind: command
category: objects-groups
subcategory: shortcut helper
summary: Internal shortcut/auto-completion helper for group action keywords.
parity: internal
---

## Purpose
`group_sc` is an internal shortcut helper backing tab-completion and abbreviation matching for the `group` command's `action` argument. It is not a user-facing command; it exists so partial action names (e.g. `tog` -> `toggle`) resolve correctly.

## Syntax
`group_sc(sc=<Shortcut>, gnot=<opaque>)`

| Param | Type | Default | Meaning |
| --- | --- | --- | --- |
| `sc` | Shortcut | `pymol.shortcut.Shortcut` | Shortcut table of group action keywords |
| `gnot` | opaque | `<opaque>` | Internal completion state |

## Behaviour
Provides the shortcut/abbreviation resolution used when parsing `group`'s `action`. Introspected parameters are internal defaults, not values you set; treat this as an implementation detail of the `group` command.

## Related
- [group](./group.md)

## Source
`docs/api-reference/commands.mdx:1755` (introspected). Parity: internal helper; group-action resolution folded into `packages/engine-ts/src/cmd/editing.ts`.
