# UI audit — deterministic "does every button work?" harness

A repeatable audit of every interactive affordance in `apps/web`, producing a
map of what does not work (`docs/audit/BROKEN-MAP.md`).

## Why it exists

Past passes let an agent wander the UI and click what it noticed — non-deterministic,
and it missed whatever it didn't happen to see. This replaces that with a **fixed
coverage contract + a deterministic executor + adversarial verification**:

1. **Inventory (exhaustive, source-derived).** One reader per feature directory in
   the frozen registry (`apps/web/src/features/*`) enumerates every button, toggle,
   menu leaf, input, and shortcut into an executable `TestSpec` (`schema.md`). The
   directory list is fixed, so no area is silently skipped.
2. **Execute (isolated, parallel).** `run-shard.mjs` boots its own vite + headless
   browser on free ports (local in-browser engine, `?backend=local`) and drives each
   spec, producing an objective PASS / FAIL / BLOCKED verdict from captured evidence
   (page/console errors, feedback text, viewport pixel diff, DOM state). Same spec +
   same source → same verdict. Many shards run at once because each is isolated.
3. **Verify (adversarial).** Every FAIL is re-run from scratch on a fresh stack and
   judged independently. In the first full run this rejected ~96% of raw failures as
   over-strict-check false positives — which is the point.
4. **Synthesize.** `gen-map.mjs` writes `docs/audit/BROKEN-MAP.md` from the results.

## Files

| File | Role |
|---|---|
| `schema.md` | the `TestSpec` grammar (actions + objective checks) |
| `driver.mjs` | boots a stack, executes a spec's mini-DSL, captures evidence, returns a verdict |
| `run-shard.mjs` | CLI: run one `{caps,specs}` shard file → verdicts JSON + screenshots |
| `ui-audit.workflow.mjs` | the 5-phase multi-agent workflow (inventory → execute → verify → synthesize) |
| `gen-map.mjs` | render `docs/audit/BROKEN-MAP.md` from the on-disk results |

## Run it

Whole audit (many agents, hours): `Workflow({scriptPath: 'scripts/audit/ui-audit.workflow.mjs'})`.

One area, no agents (deterministic):

```sh
node scripts/audit/run-shard.mjs docs/audit/specs/<area>.json /tmp/out.json /tmp/shots
```

Regenerate the map after runs: `node scripts/audit/gen-map.mjs`.

## Outputs (in `docs/audit/`)

- `specs/*.json` — the enumerated test map (durable coverage contract, one per area).
- `results/*.json` — per-spec verdicts + evidence.
- `evidence/*.png` — curated screenshots for confirmed defects (bulk `shots/` is gitignored).
- `BROKEN-MAP.md` — the human-readable map.
- `_summary.json` — the extracted confirmed-defect records (repro + root cause) behind the map.

## Sandbox caveats

- The remote PyMOL bridge and offscreen GL are absent here, so remote-backend /
  Mode-P / picking / server file-service specs are recorded **BLOCKED, not passing**.
- Each killed run leaks vite/chromium children; this container's init does not reap
  them, so a long run can approach the cgroup `pids.max`. If fresh stacks start failing
  with `spawn ... EAGAIN`, restart the session to clear zombies.
