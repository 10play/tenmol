---
name: pop
kind: command
category: selecting
subcategory: selection iteration
summary: Moves one atom at a time from a source selection into a named selection.
parity: implemented
---

## Purpose
`pop` iterates through an atom selection one atom at a time: each call assigns the
next atom of the source to a named selection and removes it from consideration.
It is the building block for scripted per-atom animations or step-by-step
processing loops.

## Syntax
```
pop(name, source, enable=-1, quiet=1)
```

| Param | Type | Default | Meaning |
| --- | --- | --- | --- |
| `name` | str | | destination selection that receives a single atom |
| `source` | str | | selection to draw atoms from |
| `enable` | int | `-1` | -1 leave visibility as-is; 1 enable `name`; 0 disable `name` |
| `quiet` | int | `1` | suppress feedback |

## Behaviour
Each successful call pulls one atom from `source` into `name` and returns a truthy
count; when `source` is exhausted it returns 0/false, which is how loops
terminate. If `enable > 0` the destination selection is switched on
(`_cmd.onoff(...,1)`), if `enable == 0` it is switched off. The source selection
itself is consumed atom by atom across successive calls.

## Examples
```
select src, name CA
# python
while cmd.pop("tmp", "src"):
    cmd.zoom("tmp", 2, animate=1)
    cmd.refresh()
# python end
```

## Related
- `select`, `deselect`, `iterate` - selection handling

## Source
`packages/engine/modules/pymol/selecting.py:98`. Registered in the TS port at
`packages/engine-ts/src/cmd/controlflow.ts:175`.
