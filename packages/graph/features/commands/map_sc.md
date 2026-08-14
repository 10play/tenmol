---
name: map_sc
kind: command
category: internal
subcategory: autocompletion helper
summary: Internal shortcut factory that supplies tab-completion candidates for map object names.
parity: internal
---

## Purpose
`map_sc` is not an interactive command but an internal helper used by PyMOL's command-line completion. It returns a `Shortcut` over the names of all map-type objects, so arguments like the `name` of `map_set`/`map_double` can be tab-completed.

## Syntax
`map_sc(sc=<Shortcut>, gnot=<get_names_of_type>)`

| Param | Type | Default | Meaning |
| --- | --- | --- | --- |
| `sc` | class | `pymol.shortcut.Shortcut` | Shortcut class used to build the completion table |
| `gnot` | callable | `get_names_of_type` | Function fetching object names (`object:map`) |

## Behaviour
Defined as `map_sc = lambda sc=Shortcut, gnot=get_names_of_type: sc(gnot('object:map'))`. Each call builds a fresh `Shortcut` from the current list of map objects. The completion module wires it into commands such as `map_set` (see `completing.py`). It has no user-facing side effects and is not meant to be invoked directly.

## Examples
```python
# Not called directly; used internally for tab-completion:
#   map_set <TAB>   -> lists map object names via map_sc
```

## Related
- [map_set](./map_set.md)
- [map_new](./map_new.md)

## Source
`packages/engine/modules/pymol/cmd.py:372` (definition); wired in `packages/engine/modules/pymol/completing.py:62,289`. Parity: internal helper, not ported as a command.
