---
name: as_pathstr
kind: command
category: file-io
subcategory: path handling
summary: Internal helper that normalises a filesystem path to a platform-appropriate string.
parity: internal
---

## Purpose
`as_pathstr` is an internal utility that coerces a path argument into the right string type for the current platform before it is handed to file I/O. It exists so that PyMOL handles Windows unicode file names correctly while leaving UTF-8 byte-string paths untouched on Unix.

## Syntax
`as_pathstr(path)`

| Param | Type | Default | Meaning |
| --- | --- | --- | --- |
| `path` | str/bytes | — | A filesystem path to normalise |

## Behaviour
On Windows, if `path` is `bytes` it is decoded to `str`, trying `utf-8` then `mbcs` encodings and returning the first that succeeds. On Unix (or when the input is already a `str`), the path is returned unchanged, since UTF-8 byte strings are accepted by the OS. It is a small pass-through helper used inside the `cmd` module, not an interactive command.

## Examples
```python
# internal usage inside load/save paths
p = cmd.as_pathstr(b"model.pdb")
```

## Related
- [api](./api.md)

## Source
`packages/engine/modules/pymol/cmd.py:116`. Parity: internal — path/string handling in the TypeScript port does not need this Windows-encoding shim, so no equivalent command is registered.
