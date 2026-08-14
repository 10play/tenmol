---
name: get_version
kind: command
category: control-flow-system
subcategory: version info
summary: Return a 6-tuple of PyMOL version, build date, GIT SHA and code revision.
parity: implemented
---

## Purpose
`get_version` reports the running PyMOL build's version in several
representations plus provenance metadata. Use it for compatibility checks or to
stamp output with the exact build.

## Syntax
`get_version(quiet=1)`

| Param | Type | Default | Meaning |
| --- | --- | --- | --- |
| `quiet` | int | `1` | `0` prints the version message; `<0` also prints build date and git sha |

## Behaviour
Returns a tuple of length six: `(text, float, int, build_date_unix_timestamp,
git_sha, svn_revision)` — a text version string, its floating-point and integer
forms, the build date as a Unix timestamp, the GIT SHA, and the SVN code revision
where available. It needs no lock and no object handle. With `quiet < 1` the
formatted version message is printed; with `quiet < 0` the build date
(`localtime`) and git sha are printed too.

## Examples
```python
text, fnum, inum, ts, sha, rev = cmd.get_version()
if cmd.get_version()[1] >= 2.5:
    ...
```

## Related
- [get_setting_int](get_setting_int.md)

## Source
`packages/engine/modules/pymol/querying.py:603`. Parity: implemented — present
in `packages/engine-ts/src/cmd/controlflow.ts`.
