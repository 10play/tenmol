---
name: get_session
kind: command
category: file-io
subcategory: session export
summary: Build the in-memory PSE session dictionary for some or all objects, honouring version/binary/cache settings.
parity: implemented
---

## Purpose
`get_session` assembles the session dictionary (the structure that `save x.pse`
serialises) for the given objects. Use it programmatically to capture full scene
state — objects, coordinates, settings, view, movie, scenes — in memory.

## Syntax
`get_session(names='', partial=0, quiet=1, compress=-1, cache=-1, binary=-1, version=-1)`

| Param | Type | Default | Meaning |
| --- | --- | --- | --- |
| `names` | str | `''` | Objects to export; `''` = all objects |
| `partial` | int | `0` | If true, omit selections, settings, view and movie |
| `quiet` | int | `1` | Suppress console/warnings output |
| `compress` | int | `-1` | DEPRECATED zlib-pickle the dict; `-1` = `session_compression` setting |
| `cache` | int | `-1` | Include `pymol._cache` (e.g. surface meshes); `-1` = auto per `session_cache_optimize`/`cache_mode` |
| `binary` | int | `-1` | Use efficient binary format; `-1` = `pse_binary_dump` |
| `version` | int | `-1` | Export version; `-1` = `pse_export_version` |

## Behaviour
Resolves `version` from `pse_export_version` when negative. For export versions
`< 1.76` it walks the scene list and stores legacy scene entries; for `< 1.9` it
switches on the Python-2-compatible legacy pickler. When `cache` is on and
`session_cache_optimize`/`cache_mode` warrant it, runs `cache('optimize')` first.
The C layer fills the dict, then `_session_save_tasks` run (failures reported as
warnings), legacy scenes are moved into `scene_dict`/`scene_order`, settings and
object layouts are backported via `_session_convert_legacy`, and finally the dict
is optionally zlib-compressed. Note: the session contains **no rep geometry** —
only coordinates, settings, properties and (via cache) meshes.

## Examples
```python
session = cmd.get_session()
partial = cmd.get_session("myprot", partial=1)
```

## Related
- [get_pdbstr](get_pdbstr.md), [get_scene_list](get_scene_list.md), [save](save.md)

## Source
`packages/engine/modules/pymol/exporting.py:371`. Parity: implemented — registered
at `packages/engine-ts/src/cmd/exporters.ts:568`; tracked in
`docs/feature-parity.md:155,281`.
