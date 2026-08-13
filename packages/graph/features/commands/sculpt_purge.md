---
name: sculpt_purge
kind: command
category: sculpting-minimization
subcategory: sculpting
summary: Unsupported low-level command that clears PyMOL's internal sculpting state.
parity: implemented
---

## Purpose
`sculpt_purge` is documented upstream as "an unsupported feature." It resets the internal sculpting machinery. It takes no arguments and is not part of the normal sculpting workflow (`sculpt_activate` / `sculpt_iterate` / `sculpt_deactivate`); most users never need it.

## Syntax
`sculpt_purge()`

This command takes no parameters.

## Behaviour
Upstream it drops into the C layer (`_cmd.sculpt_purge`) to purge cached sculpting data. Because it is explicitly unsupported, its exact effect is intentionally undocumented and may change; prefer `sculpt_deactivate` to cleanly stop sculpting on an object.

## Examples
```python
sculpt_purge
```

## Related
- [sculpt_deactivate](sculpt_deactivate.md) — the supported way to clear sculpting on an object
- [sculpt_activate](sculpt_activate.md)

## Source
Upstream: `packages/engine/modules/pymol/editing.py:104`. Parity: implemented at `packages/engine-ts/src/cmd/sculpt.ts:372` as a full clear of the restraint cache.
