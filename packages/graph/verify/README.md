# Feature-verification graph

An autonomous, resumable pipeline that takes **every** PyMOL feature in the manifest and proves it
works in the **TypeScript engine** (`packages/engine-ts`) by differential-testing it against **real
PyMOL** — fixing engine-ts where it diverges and committing a browser-runnable e2e probe for each
feature that passes.

## The per-feature graph

```
 feature (manifest row + features/**.md deep-dive)
   │
 [ROUTE]   router.mjs → probeKind ∈ {state · visual · ui · na}
   │
 [AUTHOR]  an agent writes a probe { ops, checks } from the deep-dive doc
   │
 [DIFF]    oracle-diff.spec.ts runs the probe on REAL PyMOL (oracle) AND engine-ts, diffs
   │
   ├─ match  → bake oracle `expected` into probes/<id>.json ; ledger: passed
   └─ differ → [FIX] an agent edits engine-ts (aggressive; full ports allowed), re-diffs
                     ├─ now matches → probes/<id>.json ; ledger: fixed
                     └─ out of scope → reports/<id>.md ; ledger: blocked
```

The committed `probes/<id>.json` is the **e2e test**: `apps/web/e2e/run-generated.mjs`
replays every probe against engine-ts **in a real headless browser** (`?backend=local`) and asserts
the baked, oracle-derived expectations — one booted stack for all probes.

## The oracle

Real PyMOL behind the bridge at `ws://100.71.244.15:8002/ws` (origin `http://100.71.244.15:3002`).
It is a **single shared instance**, so the differential serializes oracle access with a file lock.
It runs `--no-gl`, so ground truth is **state observables** (counts, view, colours, settings, model)
— which is why `visual`/`ui` features are routed but deferred until a GL/UI oracle is wired.

## Durability & enforcement (survives being killed)

The **ledger** (`status/<id>.json`, one file per feature, gitignored) is the source of truth. Every
step is idempotent and checkpointed, so a killed run loses nothing — a fresh driver re-scans and
resumes. Committed `probes/` are the permanent record; `driver.mjs reconcile` rebuilds ledger state
from them if the ledger is ever lost.

The grind is a loop of **ticks**. Each tick:

```sh
# 1. claim the next batch of workable features (atomic; sets a lease)
node packages/graph/verify/driver.mjs claim 6 --kind state --worker tick-N

# 2. run the verification Workflow on that batch  (Workflow tool, args = the batch JSON)
#    → agents author probes, diff, and fix engine-ts; they write the ledger + probes themselves

# 3. checkpoint
git add -A packages/engine-ts packages/graph/verify/probes && git commit -m "verify: tick N"
node packages/graph/verify/driver.mjs release-stale     # reclaim any abandoned lease
```

Enforcement is the `keep-going` Stop-hook armed on the goal
`node packages/graph/verify/driver.mjs remaining --kind state` **== 0**: the turn refuses to end
while features remain, so the loop keeps ticking autonomously across context summarisation and
restarts. Disarm with the `keep-going` skill to pause.

## Commands

| Command | Purpose |
|---|---|
| `node verify/seed.mjs` | seed the ledger from `manifest.json` (idempotent) |
| `node verify/status.mjs [--blocked] [--kind state]` | progress dashboard |
| `node verify/driver.mjs remaining --kind state` | count of workable features (the goal signal) |
| `node verify/driver.mjs claim <n> --kind state` | claim + print a batch |
| `node verify/driver.mjs release-stale` / `reconcile` | heal abandoned leases / rebuild from probes |
| `node apps/web/e2e/run-generated.mjs [-t <feature>]` | run the committed e2e probes in-browser |

## Files

- `config.mjs` · `ledger.mjs` · `router.mjs` · `seed.mjs` · `driver.mjs` · `mark.mjs` · `status.mjs`
- `feature-verify.workflow.js` — the batch Workflow (author→diff→fix)
- `../test/oracle-diff.spec.ts` — the node differential (oracle vs engine-ts)
- `probes/<id>.json` — committed e2e probes (the verified features)
- `status/`, `reports/`, `.work/` — runtime state (gitignored)
