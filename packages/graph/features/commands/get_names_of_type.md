---
name: get_names_of_type
kind: command
category: objects-groups
subcategory: name listing
summary: Returns the names of all objects matching a given get_type string.
parity: unknown
---

## Purpose
`get_names_of_type` returns the list of object names whose `get_type` matches a given type string (e.g. `object:molecule`, `object:map`, `object:alignment`). It is the convenient way to enumerate all objects of one kind, used by the export dialogs to populate map/alignment pickers.

## Syntax
`get_names_of_type(type, public=1)`

| Param | Type | Default | Meaning |
| --- | --- | --- | --- |
| `type` | str | (required) | A `get_type` string to match, e.g. `object:map` |
| `public` | 0/1 | `1` | If `1`, list only public objects; else include internal |

## Behaviour
This is a pure-Python wrapper: it calls `get_names('public_objects')` (or `'objects'` when `public=0`), maps each name through `get_type`, and returns those whose type equals `type`. Failures in listing/typing are swallowed (returns whatever it could resolve, possibly `[]`).

## Examples
```python
maps = cmd.get_names_of_type("object:map")
alns = cmd.get_names_of_type("object:alignment")
```

## Related
- [get_names](./get_names.md)
- [get_type](../commands/get_type.md)

## Source
`packages/engine/modules/pymol/querying.py:1459`. Parity: no dedicated TypeScript port found (composes `get_names`+`get_type`); parityStatus unknown.
