---
name: object_sc
kind: command
category: internal
subcategory: command completion
summary: Internal helper that builds a Shortcut of current object names for tab-completion.
parity: internal
---

## Purpose
`object_sc` is not a user command but an internal factory used by PyMOL's
command-completion machinery. It returns a `Shortcut` object populated with the
names of all current objects so that argument auto-completion can match against
them.

## Syntax
```
object_sc(sc=<Shortcut>, gn=get_names)
```

| Param | Type | Default | Meaning |
| --- | --- | --- | --- |
| `sc` | class | `pymol.shortcut.Shortcut` | Shortcut class used to build the matcher |
| `gn` | callable | `get_names` | function returning the object-name list |

## Behaviour
Defined as a lambda: `object_sc = lambda sc=Shortcut, gn=get_names: sc(gn('objects'))`.
Each call queries the live list of object names via `get_names('objects')` and
wraps it in a fresh `Shortcut`, giving completion code an up-to-date matcher. It
is consumed throughout `completing.py` (e.g. the `aa_obj_*` auto-argument
descriptors) and never invoked directly by end users.

## Examples
```
# internal use only — resolved by the completion layer, e.g.
aa_obj_e = [ cmd.object_sc, 'object', '' ]
```

## Related
- [Shortcut](Shortcut.md) - the prefix-matching helper it wraps
- `get_names` - source of the object list

## Source
`packages/engine/modules/pymol/cmd.py:371`; consumers in
`packages/engine/modules/pymol/completing.py:58`. Internal completion helper;
no TS port equivalent.
