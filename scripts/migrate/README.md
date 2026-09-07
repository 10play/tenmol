# Migration harness — crash-safe, resumable, self-verifying

A durable task runner for large mechanical changes (removing browser-impossible
features, then porting the rest). Built because our first big automated pass died
to a session limit mid-run and lost its progress — this one cannot.

## The three guarantees (proven in the demo, `scripts/migrate/engine.mjs` header)

1. **Saves progress** — every task transition is appended to an immutable journal
   (`state/<plan>.journal.jsonl`) and the materialized state is written atomically
   (tmp + rename), so a crash never corrupts or loses it.
2. **Resumes after any crash** — the ledger is NOT the source of truth; the working
   tree is. Each task has a machine-checkable **postcondition**, and `reconcile`
   re-derives "what is already done" by observing the repo. A change whose edit
   landed but was never recorded (killed mid-run) is detected and marked done
   without being re-applied. Same run, session restart, or fresh process — all
   reconcile to the same state.
3. **Verifies everything** — a task is only `verified` when its own gates pass
   (`postcondition`, `typecheck`, `build`, …). A gate that can't even run in a
   degraded sandbox (EAGAIN/OOM) becomes `deferred`, never a false green, and a
   later pass re-checks it. Nothing is trusted, only observed.

## Files

| File | Role |
|---|---|
| `engine.mjs` | ledger (atomic write + append-only journal), postcondition checks, verify-gate runner |
| `run.mjs` | CLI: `status` / `next` / `reconcile` / `verify` over a plan |
| `plan/*.json` | the work: `{ name, tasks: [{ id, title, postcondition, verify, deps }] }` |
| `state/*` | `<plan>.state.json` (materialized) + `<plan>.journal.jsonl` (durable log) — gitignored |

## Driving a plan

```sh
node scripts/migrate/run.mjs status    scripts/migrate/plan/<plan>.json   # where are we
node scripts/migrate/run.mjs next      scripts/migrate/plan/<plan>.json   # next task to perform
# … perform that task's change (agent or by hand) …
node scripts/migrate/run.mjs reconcile scripts/migrate/plan/<plan>.json   # checkpoint + verify; resumes
```

`reconcile` is the workhorse: run it after every change and after any crash. It
never re-applies a change already in the tree, verifies each completed task, and
leaves anything unfinished as `pending`/`blocked` for the next pass. Because it
reads the repo, **stopping the process at any moment is safe** — just run it again.

## Postcondition vocabulary (`engine.mjs`)

- `grepAbsent: [{ pattern, allow? }]` — a symbol/string must not appear outside the
  allowlist. `scripts/migrate/`, `docs/`, `packages/bridge/`, `packages/engine/`
  are always allowed (the "browser-only UI, keep bridge code" rule — backend stays).
- `pathAbsent: ["apps/web/src/features/apbs"]` — a file/dir was removed.
- `fileContains` / `fileAbsentLine` — anchor checks inside a specific file.

## Verify gates (`run.mjs`)

`postcondition` (re-check the end state), `typecheck` (`pnpm typecheck`),
`build` (`pnpm --filter @tenmol/web build`), `lint`, `webtest` (`pnpm test:ci`).
