export const meta = {
  name: 'ui-audit',
  description: 'Exhaustively test every UI affordance in the tenmol web app and map what is broken',
  whenToUse: 'Full deterministic audit of every button/menu/toggle/feature in apps/web, producing a map of what does not work',
  phases: [
    { title: 'Capabilities', detail: 'probe the runtime; decide which capability classes are testable' },
    { title: 'Inventory', detail: 'one reader per feature area emits an exhaustive, executable TestSpec file' },
    { title: 'Execute', detail: 'one isolated stack per area runs its specs to PASS/FAIL/BLOCKED' },
    { title: 'Verify', detail: 'independently re-run every FAIL on a fresh stack to kill false positives' },
    { title: 'Synthesize', detail: 'write the broken-map from confirmed failures' },
  ],
};

// The audit's coverage contract: one reader per known feature directory (from
// the frozen feature registry) plus the app chrome. The list is FIXED, so no
// area is silently skipped — that is what makes this deterministic instead of
// "whatever the agent happened to click".
const AREAS = [
  'menubar', 'viewport', 'seqview', 'render', 'objects', 'wizards', 'movie', 'scenes',
  'console', 'settings', 'files', 'dialogs', 'builder', 'colors', 'volume', 'properties',
  'texteditor', 'compute', 'plugin-manager', 'apbs', 'mouse', 'keyboard', 'shortcuts',
  'pymol-menu', 'chrome',
];

const CAPS = ['local-backend', 'webgl', 'network'];

const SCHEMA_RULES = `
You are producing TestSpecs that scripts/audit/driver.mjs will EXECUTE without judgement.
READ scripts/audit/schema.md first — it is the authoritative grammar. Key points:
- Each spec is one testable affordance. Actions: cmd,click,type,press,hover,wait,waitFor,menu.
- Menu leaves: use {"do":"menu","path":["Display","Sequence","On"]}. A disabled leaf -> BLOCKED automatically.
- Checks (objective only): noPageError(auto), noConsoleError, noNetFailure, feedbackMatches{pattern},
  feedbackNotMatches{pattern}, selectorVisible{selector}, selectorHidden{selector}, domChanged, screenshotChanged.
- Command line selector is input.cmdline__input. Menu bar buttons: .menubar__menus .menubar__item-wrap button
  (text = the menu label). Dropdown items: .menu__row[role=menuitem] with a child .menu__label.
- The app runs backend=local (in-browser TS engine) with 1crn preloaded. Load-by-path does NOT work in
  local mode; fetch <pdbid> works (network is available).
- requires: tag remote-backend / bridge-gl / file-service / picking on specs that cannot work in local mode,
  so they are recorded BLOCKED (not FAIL). Everything testable in local mode: leave requires empty.
- Prefer at least one AFFIRMATIVE check per spec (screenshotChanged / selectorVisible / feedbackMatches),
  not only noPageError — a control that silently does nothing is a defect worth catching.`;

const INVENTORY_SCHEMA = {
  type: 'object',
  required: ['area', 'specFile', 'specCount'],
  properties: {
    area: { type: 'string' },
    specFile: { type: 'string' },
    specCount: { type: 'integer' },
    coverageNotes: { type: 'string' },
  },
};

const EXEC_SCHEMA = {
  type: 'object',
  required: ['area', 'pass', 'fail', 'blocked', 'fails'],
  properties: {
    area: { type: 'string' },
    resultFile: { type: 'string' },
    pass: { type: 'integer' },
    fail: { type: 'integer' },
    blocked: { type: 'integer' },
    fails: {
      type: 'array',
      items: {
        type: 'object',
        required: ['id', 'label', 'reason'],
        properties: {
          id: { type: 'string' }, label: { type: 'string' }, reason: { type: 'string' },
          screenshot: { type: 'string' }, visualVerdict: { type: 'string' },
        },
      },
    },
  },
};

const VERIFY_SCHEMA = {
  type: 'object',
  required: ['id', 'confirmed', 'severity', 'summary'],
  properties: {
    id: { type: 'string' },
    confirmed: { type: 'boolean' },
    severity: { type: 'string', enum: ['blocker', 'major', 'minor', 'not-a-bug'] },
    summary: { type: 'string' },
    repro: { type: 'string' },
    evidence: { type: 'string' },
    area: { type: 'string' },
  },
};

// ---- Phase 1: Capabilities ------------------------------------------------
phase('Capabilities');
const caps = await agent(
  `Determine the runtime capabilities for the tenmol UI audit. Working dir is the repo root
(apps/web, scripts/audit exist). The audit backend is the in-browser TS engine (?backend=local).
Confirm by reading scripts/audit/driver.mjs and scripts/audit/schema.md and by running a quick check:
\`timeout 30 curl -s -o /dev/null -w '%{http_code}' --max-time 8 https://files.rcsb.org/download/1crn.pdb\`.
Report which of these capability tags are present: local-backend, webgl, network, remote-backend,
bridge-gl, file-service. In this sandbox the remote PyMOL bridge is NOT booted and there is no offscreen
GL, so remote-backend/bridge-gl/file-service are ABSENT (specs needing them must be BLOCKED, not FAIL).
Return the definitive caps list the runner should use.`,
  { phase: 'Capabilities', schema: { type: 'object', required: ['caps'], properties: { caps: { type: 'array', items: { type: 'string' } }, notes: { type: 'string' } } } },
);
const capsList = (caps && caps.caps && caps.caps.length) ? caps.caps.filter((c) => CAPS.includes(c)) : CAPS;
log(`capabilities: ${capsList.join(', ')}`);

// ---- Phases 2+3: Inventory -> Execute (pipelined per area) -----------------
const perArea = await pipeline(
  AREAS,
  // Stage A — inventory the area exhaustively, write an executable spec file.
  (area) => agent(
    `You are the INVENTORY reader for the "${area}" area of the tenmol web app (apps/web/src).
${area === 'chrome'
  ? 'This area = the app SHELL/chrome NOT owned by a feature dir: apps/web/src/shell/** (StatusBar, AppShell, ThemeToggle, overlay/panel launcher) and any viewport-overlay rep toggles (the "cartoon P G / sticks P G / spheres P G / surface" row — find where it renders, likely features/console/OrthoConsole.tsx or QuickButtons.tsx). Enumerate every clickable/toggleable affordance there.'
  : `This area = apps/web/src/features/${area}/**. Read ALL of its source (panels, buttons, inputs, toggles, menus, keyboard handlers). ${area === 'menubar' ? 'You OWN the entire menu bar: enumerate EVERY leaf in apps/web/src/layout/menuData.ts — all 11 top-level menus, every command/check/radio/submenu leaf. Use {"do":"menu","path":[...]} for each. This is the largest area; be exhaustive, do not truncate.' : ''}`}

${SCHEMA_RULES}

Be EXHAUSTIVE: every distinct button, toggle, menu leaf, input, keyboard shortcut, and drag/right-click
affordance is its own spec. Past audits MISSED things by sampling — do not sample, enumerate. If an
affordance cannot be driven deterministically (e.g. free 3D mouse-drag on the canvas), still record a
spec with the closest observable check and note the limitation.

Write the file docs/audit/specs/${area}.json with exactly this shape:
{ "area": "${area}", "caps": ${JSON.stringify(capsList)}, "specs": [ ...TestSpec... ] }
Create the docs/audit/specs directory if needed. Validate it is valid JSON (run: node -e "JSON.parse(require('fs').readFileSync('docs/audit/specs/${area}.json'))").
Then return the area, the specFile path, the specCount, and one line on coverage.`,
    { label: `inv:${area}`, phase: 'Inventory', agentType: 'general-purpose', schema: INVENTORY_SCHEMA },
  ),
  // Stage B — execute that area's specs on its own isolated stack, judge visuals.
  (inv, area) => {
    if (!inv || !inv.specCount) return { area, pass: 0, fail: 0, blocked: 0, fails: [], skipped: true };
    return agent(
      `Execute the audit specs for the "${area}" area. Steps:
1. Run: \`timeout 1800 node scripts/audit/run-shard.mjs docs/audit/specs/${area}.json docs/audit/results/${area}.json docs/audit/shots/${area}\`
   (each invocation boots its OWN isolated vite+browser stack on free ports — safe to run concurrently with other areas.)
2. Read docs/audit/results/${area}.json. It has { results: [ {id, verdict, reason, checks, evidence, screenshot, needsVisual, note} ] }.
3. For EVERY result whose verdict is FAIL, and every result with needsVisual=true, OPEN its screenshot
   (Read the screenshot path) and judge against its note: does the affordance actually work as intended?
   - If the screenshot shows the expected effect and the FAIL was a check artifact (e.g. a benign timing miss),
     downgrade it: set visualVerdict "actually-works".
   - If it confirms breakage (error text, nothing happened, wrong result), keep it and set visualVerdict "broken".
4. If the run-shard command itself errors/times out, report that as a single fail with id "${area}.__runner".
Return: area, resultFile, counts (pass/fail/blocked), and the fails array (id,label,reason,screenshot,visualVerdict)
INCLUDING only fails whose visualVerdict is NOT "actually-works".`,
      { label: `exec:${area}`, phase: 'Execute', agentType: 'general-purpose', schema: EXEC_SCHEMA },
    );
  },
);

const areaResults = perArea.filter(Boolean);
const allFails = areaResults.flatMap((r) => (r.fails ?? []).map((f) => ({ ...f, area: r.area })));
log(`execution complete: ${areaResults.length} areas, ${allFails.length} candidate failures to verify`);

// ---- Phase 4: Verify (adversarial, fresh stack per failure) ---------------
phase('Verify');
const verified = await parallel(
  allFails.map((f) => () => agent(
    `Adversarially RE-VERIFY one candidate UI failure, from scratch, to eliminate false positives.
Candidate: area="${f.area}" id="${f.id}" label="${f.label || ''}"
Reported reason: ${f.reason || '(none)'}
Screenshot (if any): ${f.screenshot || '(none)'}

Do NOT trust the prior run. Reproduce independently:
1. Find this spec in docs/audit/specs/${f.area}.json (match by id). Read its trigger/checks/note.
2. Write a one-spec shard to /tmp/verify-${f.id.replace(/[^a-z0-9]/gi, '_')}.json in the form
   { "caps": ${JSON.stringify(capsList)}, "specs": [ <that spec> ] } and run:
   \`timeout 600 node scripts/audit/run-shard.mjs /tmp/verify-${f.id.replace(/[^a-z0-9]/gi, '_')}.json /tmp/verify-${f.id.replace(/[^a-z0-9]/gi, '_')}.out.json /tmp/vshots\`
3. Open the fresh screenshot and read the fresh result. Decide: is this a REAL defect a user would hit?
   - Default to confirmed=false if the affordance actually works and the failure was a check/timing artifact.
   - confirmed=true only if the control genuinely throws, errors, or does nothing when it should do something.
Classify severity: blocker (crashes/unusable), major (feature broken), minor (cosmetic/edge), or not-a-bug.
Return id, area, confirmed, severity, a one-line summary, concise repro steps, and the key evidence.`,
    { label: `verify:${f.id}`, phase: 'Verify', agentType: 'general-purpose', schema: VERIFY_SCHEMA },
  )),
);

const confirmed = verified.filter(Boolean).filter((v) => v.confirmed && v.severity !== 'not-a-bug');
log(`verified: ${confirmed.length}/${allFails.length} candidate failures CONFIRMED as real defects`);

// ---- Phase 5: Synthesize the broken-map -----------------------------------
phase('Synthesize');
const blockedTotal = areaResults.reduce((n, r) => n + (r.blocked ?? 0), 0);
const passTotal = areaResults.reduce((n, r) => n + (r.pass ?? 0), 0);
const failTotal = areaResults.reduce((n, r) => n + (r.fail ?? 0), 0);

const synth = await agent(
  `Write the AUDIT MAP for the tenmol web-app UI audit as docs/audit/BROKEN-MAP.md.

Totals across ${areaResults.length} areas: PASS=${passTotal}, FAIL(raw)=${failTotal}, BLOCKED=${blockedTotal}.
Confirmed real defects after adversarial re-verification: ${confirmed.length}.

Per-area raw results: ${JSON.stringify(areaResults.map((r) => ({ area: r.area, pass: r.pass, fail: r.fail, blocked: r.blocked })))}

Confirmed defects (this is the map's core): ${JSON.stringify(confirmed)}

Also read docs/audit/results/*.json for the full per-spec detail and screenshots under docs/audit/shots/.

Produce docs/audit/BROKEN-MAP.md with:
1. A summary table: per area — total specs, pass, confirmed-broken, blocked.
2. A "Confirmed broken" section GROUPED BY AREA, each defect with: id, human label, severity, one-line
   symptom, repro steps, screenshot path. Order areas by number of confirmed defects (most first).
3. A "Blocked / untestable here" section explaining the capability gaps (no remote bridge, no offscreen GL,
   no server file-service) and listing how many specs each blocked — so a reader knows what was NOT covered
   and why (never present blocked as passing).
4. A short "How to re-run" note pointing at scripts/audit/run-shard.mjs and docs/audit/specs/*.json.
Keep it factual and skimmable. Return the mapFile path and the confirmed-defect count.`,
  { phase: 'Synthesize', agentType: 'general-purpose', schema: { type: 'object', required: ['mapFile', 'confirmedDefects'], properties: { mapFile: { type: 'string' }, confirmedDefects: { type: 'integer' } } } },
);

log(`audit complete — ${confirmed.length} confirmed defects mapped in ${synth?.mapFile ?? 'docs/audit/BROKEN-MAP.md'}`);
return {
  areas: areaResults.length,
  pass: passTotal,
  rawFail: failTotal,
  blocked: blockedTotal,
  confirmedDefects: confirmed.length,
  map: synth?.mapFile ?? 'docs/audit/BROKEN-MAP.md',
  confirmed,
};
