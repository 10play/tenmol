---
name: finish_object
kind: command
category: file-io
subcategory: bulk loading
summary: Finalizes an object's processing after states were loaded with the finish flag disabled, for efficient bulk multi-state loading.
parity: implemented
---

## Purpose
`finish_object` completes the deferred processing of an object whose states were loaded with `finish=0`. It exists so that when many states are loaded one at a time, PyMOL can skip per-state processing until all states are in RAM, then finish once.

## Syntax
`finish_object(name)`

| Param | Type | Default | Meaning |
| --- | --- | --- | --- |
| `name` | str | | name of the object to finalize |

## Behaviour
This function should always be called after loading an object with the finish flag set to zero. It triggers the geometry/representation processing that was deferred during the bulk load. Calling it on a normally-loaded object is a no-op-level refinalize.

## Examples
```python
for i, path in enumerate(frames):
    cmd.load(path, "traj", state=i+1, finish=0)
cmd.finish_object("traj")
```

## Related
- [load](load.md) - the loader whose `finish` flag this pairs with

## Source
`packages/engine/modules/pymol/importing.py` (`def finish_object`). Parity: implemented in `packages/engine-ts/src/cmd/misc2.ts:68` (republish).
