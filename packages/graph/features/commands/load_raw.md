---
name: load_raw
kind: command
category: file-io
subcategory: in-memory loader
summary: API-only loader that parses structure data held in a Python string/bytes buffer, given its format.
parity: unknown
---

## Purpose
`load_raw` loads molecular (or map) data that already lives in memory as a string or
bytes buffer, without touching the filesystem. Reach for it when content arrives over
a network, from a database, or from another library, and you know its format.

## Syntax
`load_raw(content, format, object='', state=0, finish=1, discrete=-1, quiet=1, multiplex=None, zoom=-1)`

| Param | Type | Default | Meaning |
| --- | --- | --- | --- |
| `content` | str/bytes | — | the raw data buffer |
| `format` | str | — | format identifier (e.g. `pdb`, `mol`, `mmtf`, `dx`) |
| `object` | str | `''` | destination object name |
| `state` | int | 0 | 1-based state; 0 appends |
| `finish` | int | 1 | perform (1) or defer (0) post-processing |
| `discrete` | int | -1 | discrete-state flag (-1 = auto) |
| `quiet` | int | 1 | suppress chatter |
| `multiplex` | int | None | split multi-model data into objects (None -> -2) |
| `zoom` | int | -1 | auto-zoom behaviour |

## Behaviour
The format string is resolved against the `loadable` namespace. If it maps to a
known type code, the buffer is passed straight to `_cmd.load` under the API lock.
Otherwise `load_raw` writes the content to a temporary file and defers to `load`,
letting the higher-level format handlers (Python parsers) take over — with assertions
guarding a few formats (`cif`, `pdb`, `dx`, `mmtf`) that must have a direct type
code. `multiplex=None` is normalised to -2. API only — no command-line form.

## Examples
```python
data = open("example.mmtf", "rb").read()
cmd.load_raw(data, "mmtf")
```

## Related
- [load_embedded](load_embedded.md) — loads script-embedded blocks via `load_raw`
- [load_object](load_object.md) — generic object loader

## Source
`packages/engine/modules/pymol/importing.py:898` (`def load_raw`). Not present in
`packages/engine-ts/src`.
