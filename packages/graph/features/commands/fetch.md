---
name: fetch
kind: command
category: file-io
subcategory: remote download
summary: Downloads a structure or map from the internet by accession code and loads it as an object.
parity: unknown
---

## Purpose
`fetch` pulls a file from a remote repository (PDB, EMDB, etc.) given its identifier and loads it directly, saving the load-from-disk round trip. It is the standard one-liner to get a structure into a fresh session.

## Syntax
`fetch(code, name='', state=0, finish=1, discrete=-1, multiplex=-2, zoom=-1, type='', async_=0, path='', file=None, quiet=1)`

| Param | Type | Default | Meaning |
| --- | --- | --- | --- |
| `code` | str | | single PDB identifier or list; 5-letter codes fetch a single chain (e.g. `1a00A`) |
| `name` | str | `''` | object name to load into |
| `state` | int | `0` | state number to load into |
| `finish` | int | `1` | finish object processing after load |
| `discrete` | int | `-1` | force discrete state storage |
| `multiplex` | int | `-2` | split multi-model files into separate objects |
| `zoom` | int | `-1` | zoom after load |
| `type` | str | `''` | `cif`, `bcif`, `pdb`, `pdb1`, `2fofc`, `fofc`, `emd`, `cid`, `sid` (default: cif) |
| `async_` | 0/1 | `0` | download in the background without blocking the CLI |
| `path` | str | `''` | local cache/download directory |
| `file` | str | `None` | explicit output filename |
| `quiet` | int | `1` | suppress feedback |

## Behaviour
The default `type` is `cif` (it was `pdb` up to PyMOL 1.7.6). `async_` changed default to 0 in PyMOL 2.3, so by default fetch is synchronous; set `async_=1` for background download. Because the download happens over the network, it fails behind firewalls without direct internet access. `async` (no underscore) is accepted as an alias. Fetched files are cached under `path` (or the `fetch_path` setting).

## Examples
```python
fetch 1rx1
fetch 1a00A, type=cif
fetch 1oky, async_=1
```

## Related
- [load](load.md) - load a local file
- [fetch_path](../settings/fetch_path.md) - default download location

## Source
`packages/engine/modules/pymol/importing.py` (`def fetch`). Parity: not registered as an engine-ts command.
