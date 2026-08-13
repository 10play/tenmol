---
name: meter_reset
kind: command
category: internal
subcategory: diagnostics
summary: Resets the frames-per-second (rate) counter.
parity: planned
---

## Purpose
`meter_reset` zeroes the running frames-per-second counter. Reach for it after a
stall or when you want a clean rate measurement for the subsequent rendering
window.

## Syntax
```
meter_reset()
```

| Param | Type | Default | Meaning |
| --- | --- | --- | --- |
| _(none)_ | | | |

## Behaviour
Acquires the command lock and calls `_cmd.reset_rate`, discarding accumulated
timing so the on-screen FPS meter restarts from the next frame. No effect on
geometry or the scene.

## Examples
```
meter_reset
```

## Related
- [mem](mem.md) - dump memory state (another diagnostic)

## Source
`packages/engine/modules/pymol/viewing.py:1800`. Not registered in the TS port.
