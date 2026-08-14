export const meta = {
  name: 'feature-verify',
  description: 'Verify a batch of PyMOL features in engine-ts vs real PyMOL; author a probe, diff, fix engine-ts, commit an e2e probe',
  phases: [
    { title: 'Author', detail: 'per feature: author a probe + run the oracle-vs-engine-ts differential (read-only)' },
    { title: 'Fix', detail: 'serially fix engine-ts for features that diverged, then re-diff' },
  ],
}

// args = the claimed batch: [{id, feature, kind, category, subcategory, summary, signature, doc, probeKind, attempts}, ...]
// Accept an array OR a JSON string (the runtime may stringify the args value).
const BATCH = Array.isArray(args) ? args : typeof args === 'string' && args.trim() ? JSON.parse(args) : []
const REPO = '/home/tenplay/Documents/GitHub/10ground/sessions/map/tenmol'
const MAX_FIX_ROUNDS = 4

if (BATCH.length === 0) {
  log('feature-verify: empty batch, nothing to do')
  return { authored: 0, passed: 0, fixed: 0, blocked: 0, note: 'empty batch' }
}
log(`feature-verify: ${BATCH.length} feature(s): ${BATCH.map((f) => f.id).join(', ')}`)

// ---------------------------------------------------------------------------
const PROBE_SCHEMA = `A probe is JSON: {
  "id": "<feature id>", "feature": "<name>", "kind": "<kind>", "probeKind": "<state|visual|ui>",
  "ops":    [ {"do":"<pymol command line>"} | {"call":["<fn>", <arg>...], "kwargs": {...}} ],
  "checks": [ {"call":["<query fn>", <arg>...], "label":"<what this observes>", "tol": <optional number> } ],
  "tol": 1e-3
}
- ops set up + exercise the feature. Prefer deterministic setup: 'fragment ala' (a 10-atom alanine
  in real PyMOL, 5 heavy-only in engine-ts today), 'pseudoatom', or load a bundled structure with
  {"do":"load ${'$'}{REPO}/packages/engine/test/dat/1tii.pdb, m"} (a real protein — has chains/ss).
- checks read OBSERVABLE state through the PUBLIC API that BOTH engines implement, so a single cmd
  call returns a comparable value. Good observers: count_atoms(selector), get_color_index(name),
  get_color_tuple(name), get_setting_float/int/text/boolean(name[,obj]), get_view(), get_extent(sel),
  get_distance/get_angle/get_dihedral(...), get_names(...), get_chains(...), get_title(...),
  get_model(sel) (coords), get_atom_coords(sel). Each check MUST return a value (never rely on pixels
  — the oracle is headless/--no-gl).
- Pick checks that PROVE the feature did its job. Examples:
    setting  -> ops: set <name>, <val>  ; check: get_setting_<type>("<name>")  == <val>
    selection-> ops: load a structure   ; check: count_atoms("<your selector>")
    color    -> ops: color red, <sel>   ; check: get_color_index("red") and count_atoms bookkeeping
    rep      -> ops: as spheres, <sel>  ; check: count_atoms("rep spheres")
    command  -> exercise it, then observe its documented side effect via a get_*/count_atoms`

const RUN_DIFF = (id) =>
  `cd ${REPO} && mkdir -p packages/graph/verify/.work && \\
TENMOL_PROBE_FILE=packages/graph/verify/.work/${id}.probe.json \\
TENMOL_DIFF_OUT=packages/graph/verify/.work/${id}.diff.json \\
node node_modules/vitest/vitest.mjs run packages/graph/test/oracle-diff.spec.ts 2>&1 | tail -4 ; \\
echo '---DIFF---' ; cat packages/graph/verify/.work/${id}.diff.json`

const COMMON = (f) => `You are verifying ONE PyMOL feature against REAL PyMOL for the tenmol project — a
faithful port of PyMOL's engine to TypeScript (packages/engine-ts). Working dir: ${REPO}

FEATURE: ${f.kind} "${f.feature}"  (id: ${f.id}, category: ${f.category}, probeKind: ${f.probeKind})
Summary: ${f.summary}
Signature: ${f.signature || '(n/a)'}
Deep-dive doc: ${f.doc ? `packages/graph/${f.doc.replace(/^packages\/graph\//, '')}` : '(none)'}

Ground truth to consult: the deep-dive doc, docs/api-reference/commands.mdx (the '### cmd.${f.feature}'
block for exact params/defaults), and packages/engine/modules/pymol/*.py.

THE ORACLE is real PyMOL behind the bridge (state observables only; headless/--no-gl). The differential
tool runs your probe through BOTH real PyMOL and engine-ts and writes the diff.

${PROBE_SCHEMA}`

const AUTHOR_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    id: { type: 'string' },
    outcome: { type: 'string', enum: ['passed', 'diverged', 'oracle-error', 'unprobeable'] },
    checks: { type: 'number' },
    diffCount: { type: 'number' },
    diffSummary: { type: 'string' },
    note: { type: 'string' },
  },
  required: ['id', 'outcome'],
}

const FIX_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    id: { type: 'string' },
    outcome: { type: 'string', enum: ['fixed', 'blocked'] },
    rounds: { type: 'number' },
    filesChanged: { type: 'array', items: { type: 'string' } },
    blockedReason: { type: 'string' },
    note: { type: 'string' },
  },
  required: ['id', 'outcome'],
}

function authorPrompt(f) {
  return `${COMMON(f)}

TASK — author a probe and run the differential (do NOT edit engine-ts in this step):
1. Understand what "${f.feature}" does and what observable effect proves it worked.
2. Write the probe JSON to: packages/graph/verify/.work/${f.id}.probe.json  (id="${f.id}", feature="${f.feature}").
   Keep it tight: 1-6 ops, 1-5 checks. Every check must be a single cmd call returning a value.
3. Run the differential EXACTLY:
${RUN_DIFF(f.id)}
   Read the printed diff JSON: { ok, oracleError, expected, actual, diffs:[{label,expected,actual}] }.
4. Interpret + record via the ledger CLI (always run mark.mjs once):
   - ok === true  -> engine-ts already matches PyMOL. Write the COMMITTED probe to
       packages/graph/verify/probes/${f.id}.json  = your probe PLUS "expected": <the diff's expected array>.
       Then: node packages/graph/verify/mark.mjs ${f.id} --state passed --probe packages/graph/verify/probes/${f.id}.json --note "matched oracle"
       Return outcome "passed".
   - diffs non-empty (oracleError null) -> engine-ts DIVERGES. Leave the .work probe in place (the Fix step
       needs it). Run: node packages/graph/verify/mark.mjs ${f.id} --state claimed --note "diverged: <short>" --diff '<the diff json, compact>'
       Return outcome "diverged" with diffCount + a 1-line diffSummary (which checks differ, expected vs actual).
   - oracleError set (PyMOL itself errored / your ops were invalid) -> revise the probe once and re-run. If the
       oracle genuinely cannot run it, mark: node packages/graph/verify/mark.mjs ${f.id} --state blocked --reason "oracle-error: <msg>"
       Return outcome "oracle-error".
   - The feature has no state-observable effect (pure pixels/UI) -> mark: node packages/graph/verify/mark.mjs ${f.id} --state blocked --reason "needs-<gl|ui>-oracle: <why>"
       Return outcome "unprobeable".
Be faithful: never invent params/defaults; copy them from commands.mdx. Return the schema object.`
}

function fixPrompt(f) {
  return `${COMMON(f)}

The Author step found that engine-ts DIVERGES from real PyMOL for "${f.feature}". The probe is at
packages/graph/verify/.work/${f.id}.probe.json and the last diff at packages/graph/verify/.work/${f.id}.diff.json
(read both first).

TASK — FIX engine-ts so it matches real PyMOL, then commit the probe. You MAY make large changes,
including porting a whole missing subsystem, but stay within this feature's scope.
1. Read the diff: which checks differ (expected = real PyMOL, actual = engine-ts).
2. Locate the responsible engine-ts code. Command handlers live in packages/engine-ts/src/cmd/*.ts
   (registered via packages/engine-ts/src/cmd/registrars.ts and Engine.register in src/engine.ts);
   selection logic in src/select/, geometry in src/geometry/, model/atoms in src/model/, coloring in
   src/exec/color.ts + src/cmd/coloring.ts. Grep for the symbol.
3. Make the fix. Match PyMOL's real behaviour (consult packages/engine/modules/pymol/*.py and the
   deep-dive doc). Keep the surrounding code style.
4. Re-run the differential (up to ${MAX_FIX_ROUNDS} rounds total):
${RUN_DIFF(f.id)}
5. When ok === true: write the COMMITTED probe packages/graph/verify/probes/${f.id}.json (your probe +
   "expected": <diff.expected>), then:
     node packages/graph/verify/mark.mjs ${f.id} --state fixed --probe packages/graph/verify/probes/${f.id}.json --note "<what you changed>"
   Return outcome "fixed" with filesChanged.
6. If after ${MAX_FIX_ROUNDS} rounds it still diverges (or the fix is out of scope), STOP editing, revert
   any half-baked changes that break other things, write a scoped report to
   packages/graph/verify/reports/${f.id}.md (what diverges, root cause, what a full fix needs), then:
     node packages/graph/verify/mark.mjs ${f.id} --state blocked --reason "<one line>"
   Return outcome "blocked" with blockedReason.
Do NOT break the build. If unsure a change is safe, prefer a smaller correct fix. Return the schema object.`
}

// ---- Phase A: author + diff, in PARALLEL (read-only on engine-ts; oracle serialized by file lock) ----
phase('Author')
const authored = await parallel(
  BATCH.map((f) => () =>
    agent(authorPrompt(f), { label: `author:${f.feature}`, phase: 'Author', agentType: 'general-purpose', schema: AUTHOR_SCHEMA }),
  ),
)
const clean = authored.filter(Boolean)
const passed = clean.filter((a) => a.outcome === 'passed')
const diverged = clean.filter((a) => a.outcome === 'diverged')
const authorBlocked = clean.filter((a) => a.outcome === 'oracle-error' || a.outcome === 'unprobeable')
log(`author: ${passed.length} passed, ${diverged.length} diverged, ${authorBlocked.length} unprobeable/oracle-error`)

// ---- Phase B: fix divergences SERIALLY (avoid concurrent engine-ts edits) ----
phase('Fix')
const fixResults = []
for (const a of diverged) {
  const f = BATCH.find((x) => x.id === a.id)
  if (!f) continue
  const r = await agent(fixPrompt(f), { label: `fix:${f.feature}`, phase: 'Fix', agentType: 'general-purpose', schema: FIX_SCHEMA })
  if (r) fixResults.push(r)
}
const fixed = fixResults.filter((r) => r.outcome === 'fixed')
const fixBlocked = fixResults.filter((r) => r.outcome === 'blocked')
log(`fix: ${fixed.length} fixed, ${fixBlocked.length} blocked`)

return {
  batch: BATCH.length,
  passed: passed.length,
  fixed: fixed.length,
  blocked: authorBlocked.length + fixBlocked.length,
  diverged: diverged.length,
  fixedIds: fixed.map((r) => r.id),
  blockedIds: [...authorBlocked.map((a) => a.id), ...fixBlocked.map((r) => r.id)],
}
