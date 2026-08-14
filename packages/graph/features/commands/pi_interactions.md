---
name: pi_interactions
kind: command
category: measurement
subcategory: pi interactions
summary: Finds pi-pi and pi-cation interactions (incentive-only in upstream PyMOL).
parity: partial
---

## Purpose
`pi_interactions` detects aromatic pi-pi stacking and pi-cation contacts and
draws them as a distance-style measurement object. It is a convenience wrapper
equivalent to `distance(..., mode=5, label=0)`.

## Syntax
```
pi_interactions(name='', selection1='all', selection2='same', state=0,
                state1=-3, state2=-3, quiet=1, reset=0)
```

| Param | Type | Default | Meaning |
| --- | --- | --- | --- |
| `name` | str | `''` | name of the measurement object to create |
| `selection1` | str | `'all'` | first atom selection |
| `selection2` | str | `'same'` | second selection (`same` = selection1) |
| `state` | int | `0` | global state (0 = all) |
| `state1` | int | `-3` | state for selection1 |
| `state2` | int | `-3` | state for selection2 |
| `quiet` | int | `1` | suppress feedback |
| `reset` | int | `0` | reset/replace an existing object of the same name |

## Behaviour
In open-source PyMOL the Python function immediately raises
`IncentiveOnlyException` — the detection logic ships only with Incentive PyMOL.
It is documented as identical to `cmd.distance(..., mode=5, label=0)`. The
tenmol TypeScript port registers it as a no-op returning an empty dict, matching
the "not available" upstream behaviour rather than computing interactions.

## Examples
```
pi_interactions pipi, chain A, chain B
```

## Related
- `distance` - the underlying measurement mode this wraps

## Source
`packages/engine/modules/pymol/querying.py:525` (raises `IncentiveOnlyException`).
No-op stub in the TS port at `packages/engine-ts/src/cmd/extras.ts:567`.
