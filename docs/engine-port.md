# The TypeScript engine port

`@tenmol/engine-ts` is an in-browser TypeScript port of PyMOL's engine, exposed as a
`@tenmol/backend` `Backend` so the web app can run against it instead of the Python bridge (see
[architecture.md §10b](architecture.md#10b-two-backends-behind-one-interface)). This document tracks
what is ported and how parity with real PyMOL is proven.

## How parity is proven

The differential equivalence suite in `tools/parity` runs the **same** command scripts through both
engines and compares **every observable**. It is layered:

- **Golden fixtures** (`tools/parity/fixtures/golden.json`) — authoritative, hand-derived from the
  fixture's known topology and PyMOL's exact palette RGBs. `tools/parity/test/equivalence.test.ts`
  replays the corpus through `LocalBackend` and asserts zero divergence, plus independent
  ground-truth assertions so the gate is not engine-vs-itself.
- **Live differential** (`tools/parity/test/live.test.ts`, run with `TENMOL_PARITY_REMOTE=<ws>`) —
  runs the corpus through **real PyMOL** over the bridge *and* the TS engine in the same job and
  diffs live, so a fixture can never silently drift from PyMOL. `--regen` rewrites the golden from
  real PyMOL, making it the authority for the fast gate.
- **Generative** (`tools/parity/test/generative.test.ts`) — seeded random command sequences assert
  the engine is deterministic (what makes a golden gate sound) and that invariants hold.
- **Contract** (`tools/parity/test/contract.test.ts`) — both backends satisfy `Backend`, and an
  unported symbol rejects with the same error shape on both sides.

Run it all with `pnpm parity:engine` (add `--remote <ws>` for the live diff). It is a CI gate.

## Ported command slice (this increment)

Every ported symbol has an equivalence assertion that reddens if it drifts.

| Command | Notes | Gated observable |
| --- | --- | --- |
| `read_pdbstr` | PDB reader → atom table + float32 coords + bonds | `get_names`, `count_atoms` topology |
| `get_names` | objects / selections / all | list, in creation order |
| `count_atoms` | selection algebra | count over a battery of selectors |
| `select` | named selections | count; membership in later selectors |
| selection algebra | `name/elem/chain/resn/resi(+ranges)/index/id/segi/alt/color/rep`, `and/or/not`, `()` , object refs | `count_atoms` |
| `color` + palette | `get_color_index` / `get_color_tuple` | resolved RGB per name; `color X` counts |
| `show` / `hide` / `show_as` | per-atom `visRep` | `rep X` counts |
| `set` / `get_setting[_float/int/boolean]` | global settings | value |
| `get_view` / `set_view` | 18-float camera | round-trip over rotation + origins + fov |
| `turn` | camera-space rotation | property tests (live diff for exact numbers) |
| `zoom` / `orient` | frame a bounding sphere | live diff (exact clip/dist deferred) |

**Rendering.** `spheres` and `lines` are emitted as Mode-G instance buffers in the exact
`CmdWebGeometry` layout the existing three.js renderer consumes (`packages/engine-ts/src/geometry`),
so the port renders in-browser with no server draw. Frame *structure* is asserted in unit tests;
byte-parity against the live C++ accessor is a follow-up row.

## Not yet ported (rejects with `NotPorted`)

Everything else. An unported symbol rejects with a `PymolError` of type `NotPorted` (mirroring the
bridge's `NotAllowed`) — never a silent no-op — so features degrade visibly and the differential
suite sees the gap. Next increments widen the slice against the same harness: exact `turn`/`zoom`
camera parity, more representations (sticks, cartoon), more file formats, and the full command
parser.
