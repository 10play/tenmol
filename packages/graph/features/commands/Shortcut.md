---
name: Shortcut
kind: command
category: control-flow-system
subcategory: command completion
summary: Abbreviation/auto-completion engine that resolves unambiguous prefixes of a keyword set.
parity: internal
---

## Purpose
`Shortcut` is the class behind PyMOL's tab-completion and command-abbreviation system. Given a list of keywords (command names, setting names, selection keywords, etc.) it builds a lookup that maps unique prefixes and generated abbreviations back to the full keyword, so users can type the shortest unambiguous form.

## Syntax
`Shortcut(keywords=None, filter_leading_underscore=True)`

| Param | Type | Default | Meaning |
| --- | --- | --- | --- |
| `keywords` | Optional iterable | `None` | Keyword strings to index; `None` means empty |
| `filter_leading_underscore` | bool | `True` | Drop keywords starting with `_` from completion |

## Behaviour
On construction it copies `keywords` (skipping `_`-prefixed names unless disabled), then calls `_optimize_symbols` per keyword and `_rebuild_finalize` to populate the `shortcut` dict and `abbreviation_dict`. `__getitem__` returns the resolved keyword (or `None`/ambiguous marker), `__contains__` tests membership, and `__delitem__` removes a keyword and rebuilds. Abbreviations shorten each underscore-delimited component to its first `groups_length` characters (e.g. `abc_def_ghig` → `a_d_ghig`). It is infrastructure used throughout the parser, not a callable command verb.

## Examples
```python
sc = Shortcut(['color', 'colour', 'cartoon'])
sc['cart']   # -> 'cartoon' (unique prefix)
'color' in sc  # -> True
```

## Related
- [SafeEvalNS](./SafeEvalNS.md)
- [api](./api.md)

## Source
`packages/engine/modules/pymol/shortcut.py:21`. Parity: internal — command-name completion in the front-end/TS engine is handled separately from this class.
