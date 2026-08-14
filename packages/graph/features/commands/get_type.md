---
name: get_type
kind: command
category: querying
subcategory: object introspection
summary: Return a string describing the kind of a named object or selection.
parity: implemented
---

## Purpose
`get_type` classifies a named entity, returning a short string that says whether
it is a molecule, map, mesh, surface, CGO, group, etc., or a selection. Use it to
branch logic on object kind before applying kind-specific commands.

## Syntax
`get_type(name, quiet=1)`

| Param | Type | Default | Meaning |
| --- | --- | --- | --- |
| `name` | str | — | Object or selection name |
| `quiet` | int | `1` | If `0`, prints the returned type string |

## Behaviour
Returns one of: `object:molecule`, `object:map`, `object:mesh`, `object:slice`,
`object:surface`, `object:measurement`, `object:cgo`, `object:group`,
`object:volume`, or `selection`. With `quiet=0` the value is printed.

## Examples
```python
cmd.get_type("1abc")        # -> 'object:molecule'
if cmd.get_type("mymap") == "object:map":
    cmd.isomesh("m", "mymap", 1.0)
```

## Related
- [get_names](get_names.md), [get_names_of_type](get_names_of_type.md)

## Source
`packages/engine/modules/pymol/querying.py:1206`. Parity: implemented — used in
`packages/engine-ts/src/cmd/editing.ts`.
