---
name: file_read
kind: command
category: file-io
subcategory: internal helper
summary: Internal helper that reads a file (optionally gzip/bzip2 compressed) and returns its contents.
parity: internal
---

## Purpose
`file_read` is an internal utility, not a user-facing command. It reads a file described by a file-info handle, transparently decompressing gzip or bzip2 payloads, and returns the raw contents for other loaders to consume.

## Syntax
`file_read(finfo)`

| Param | Type | Default | Meaning |
| --- | --- | --- | --- |
| `finfo` | | | file-info handle describing the file to read |

## Behaviour
Handles plain, gzip-, and bzip2-compressed input based on the file info. It lives in `internal.py` and is invoked by importing paths rather than typed at the command line.

## Examples
```python
# internal use only - not part of the interactive command set
```

## Related
- [fetch](fetch.md), [load](load.md) - higher-level file entry points

## Source
`packages/engine/modules/pymol/internal.py` (`def file_read`). Parity: internal helper, not ported as an engine-ts command.
