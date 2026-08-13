---
name: filename_to_objectname
kind: command
category: file-io
subcategory: internal helper
summary: Internal helper that derives a legal PyMOL object name from a filesystem path.
parity: internal
---

## Purpose
`filename_to_objectname` is an internal utility used by the loaders to pick a default object name when one is not supplied. It strips the directory and extension from a path and sanitizes the result into a legal name.

## Syntax
`filename_to_objectname(fname)`

| Param | Type | Default | Meaning |
| --- | --- | --- | --- |
| `fname` | str | | filename or path to derive a name from |

## Behaviour
It calls `filename_to_format(fname)` to split off the basename and extension (accounting for `.gz`/`.bz2` double extensions and many format-alias extensions), then passes the stem through `get_legal_name` to produce a valid object identifier. Not intended for interactive use.

## Examples
```python
# internal: load derives its default object name via this helper
# e.g. "/data/1abc.pdb.gz" -> "1abc"
```

## Related
- [load](load.md), [fetch](fetch.md) - callers that use the derived name

## Source
`packages/engine/modules/pymol/importing.py` (`def filename_to_objectname`, `filename_to_format`). Parity: internal helper, not ported as an engine-ts command.
