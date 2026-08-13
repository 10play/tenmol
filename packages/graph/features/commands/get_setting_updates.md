---
name: get_setting_updates
kind: command
category: settings
subcategory: setting introspection
summary: Return the list of setting indices changed since the last poll.
parity: internal
---

## Purpose
`get_setting_updates` returns the indices of settings that have changed since it
was last called, letting the GUI refresh only the affected controls. It is the
core of the feedback timer's setting-sync mechanism — the only way checkable menu
items, radio groups, and the window title stay in step with `set`.

## Syntax
`get_setting_updates(object='', state=0)`

| Param | Type | Default | Meaning |
| --- | --- | --- | --- |
| `object` | str | `''` | Object scope; `''` = global |
| `state` | int | `0` | State index (1-based; `0` = object/global level) |

## Behaviour
Uses a non-blocking `lock_attempt`: if the lock cannot be taken immediately it
returns an empty list rather than waiting. Otherwise it calls the C
`get_setting_updates` with `state - 1` and returns the accumulated list of
changed setting indices, clearing the internal dirty set. Consuming the list is
destructive — a subsequent call returns only newly-changed indices. Marked
`# INTERNAL`.

## Examples
```python
for i in cmd.get_setting_updates():
    value = cmd.get_setting_tuple(i)[1][0]
    # refresh the GUI control bound to setting i
```

## Related
- [get_setting_tuple](get_setting_tuple.md), [set](set.md)

## Source
`packages/engine/modules/pymol/setting.py:440`. Parity: internal — INTERNAL
GUI-sync helper; no dedicated TypeScript port found.
