---
name: mem
kind: command
category: internal
subcategory: debugging
summary: Dumps the current internal memory state to standard output for debugging.
parity: implemented
---

## Purpose
`mem` dumps PyMOL's current memory accounting to standard output. It is a
debugging aid for tracking allocation, not an official part of the API, and
produces no visible change in the viewer.

## Syntax
```
mem()
```

| Param | Type | Default | Meaning |
| --- | --- | --- | --- |
| _(none)_ | | | |

## Behaviour
Locks the C layer and calls `_cmd.mem`, which writes a snapshot of tracked
memory to stdout. Output goes to the console/log, not the 3D view. Because it is
described as "a debugging feature, not an official part of the API," the exact
format is unstable and should not be parsed programmatically.

## Examples
```
mem
```

## Related
- [meter_reset](meter_reset.md) - reset the FPS counter (another diagnostic)

## Source
`packages/engine/modules/pymol/experimenting.py:55`. Registered in the TS port at
`packages/engine-ts/src/cmd/system.ts:125`.
