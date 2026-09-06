# Browser-only impossibility manifest

Which UI affordances are **architecturally impossible** in the in-browser engine
(no bridge), split from those that merely *look* blocked. Decision context:
**browser-only UI, keep bridge code** (remove the affordance from the shipped
React UI; leave `packages/bridge` + `packages/engine` untouched) and **surgical**
(remove only the impossible affordance, keep the working parts of a shared feature).

## Verdict buckets

### A. REMOVE — impossible browser-only AND not reworkable

A browser sandbox cannot execute a native binary, spawn a process, or read/write
an arbitrary host path. These affordances have no browser-native equivalent, so
they are removed from the UI (backend code stays for the bridge build).

| Affordance | Where | Why impossible |
|---|---|---|
| **APBS Electrostatics** | `features/apbs/**`, Plugin menu `dialog:'apbs'`, launcher icon | APBS is an external native solver the server shells out to (and it's a stub here: "full port WP-30"). No native process in a browser. |
| **Install Plugin…** | Plugin menu `dialog:'plugin-install'` | Installing a plugin writes to a server plugin dir and loads Python — no filesystem, no Python runtime in the browser. |
| **Working Directory ▸ Change… / File Browser** | File menu `dialog:'cd'`, `dialog:'file-browser'` | Navigating/2selecting the server filesystem. The browser has no host FS. |
| **Recent files** | File menu `{kind:'recent'}` | A server-side most-recently-used list of host paths; nothing to enumerate in a browser. |
| **Edit pymolrc** | File menu `dialog:'edit-pymolrc'` | Edits the server-side `~/.pymolrc`; no such file in a browser. |
| **Log File ▸ Open / Resume / Append** | File menu `dialog:'log-open'`, `'log-resume'`, `'log-append'` | Streams a log to a host path. |

**Kept deliberately:** *Plugin Manager* (read-only viewer, runs nothing);
*Get PDB…* (`fetch`, works over the network in-browser).

### B. REWORK — currently path/bridge-bound but browser-viable (the *implement* phase, NOT removed)

These are impossible **as currently wired** (they pass a host path to the engine)
but have a real browser-native form, so they are kept and reworked, not deleted.

| Affordance | Browser-native rework |
|---|---|
| Open… (`file-open`) | `<input type=file>` / drag-drop → load file **contents** (engine already accepts contents, `engine-ts/src/cmd/fileio.ts:32`). |
| Save Session / Save Session As… | Serialize `.pse` → `Blob` download. |
| Export Molecule / Map / Alignment | Serialize → `Blob` download. |
| Export Image ▸ PNG / GLTF / COLLADA / VRML / STL / POV-Ray | Canvas/scene → `Blob` download (PNG already trivial). |
| Run Script… (`.pml`) | Run from pasted/loaded contents (`.py` scripts remain bridge-only). |

### C. NOT A BROWSER LIMIT (mis-tagged or harness-only)

Bucket C was resolved by *verifying* each area against the live local engine
(`?backend=local`) rather than trusting the exploratory re-tag. The three areas
split cleanly, and only one was actually mis-tagged:

- **ray / image render (was 8 blocked → now 1)** — GENUINELY MIS-TAGGED, now
  reclaimed. `engine-ts/src/cmd/render.ts` raytraces in-browser AND the engine
  serves `_bridge.draw` / `_bridge.ray` / `cmd.png` locally (verified: `cmd.png`
  returns a real PNG in local mode). The 8 draw/ray/result specs carried
  `remote-backend`+`bridge-gl` on the stale belief that `_bridge` was
  bridge-only; those tags are removed. After also fixing a setup artifact (a
  Draw/Ray leaves the dialog on the RESULT page, which broke the next spec's
  `.render__tab` precondition — normalised in the driver's `resetApp`), the shard
  is **19 PASS / 1 BLOCKED**. The one remaining BLOCKED is `render.result.save`,
  which writes a host-path PNG via `cmd.png(path)` and correctly keeps
  `file-service`.

- **sequence viewer (36) — GENUINE ENGINE-TS GAP, not a spec artifact.** Verified
  live: after `set seq_view, 1` no `.seqview` element ever mounts. The
  `SequenceViewer`'s only data feed is `source.rows()` →
  `cmd.tenmol_seqview` (`apps/web/src/features/seqview/source.ts`), which is a
  **bridge-only Python panel** (`packages/bridge/tenmol_bridge/panels/seqview.py`,
  ~1.6k lines). `@tenmol/engine-ts` does not port that command — a direct call
  returns `PymolError: cmd.tenmol_seqview: not ported by @tenmol/engine-ts yet`.
  So the bootstrap probe throws, the poll errors, `payload.visible` stays false
  and the strip renders `null`. This is NOT a small D1-style wiring gap (the web
  app is fully wired; it is the *data producer* that is missing) — reclaiming it
  means porting the whole Seeker/Seq sequence pipeline (align_rows, column
  offsets, selection toggles, menus) to TS. The 36 specs therefore keep
  `remote-backend` and stay BLOCKED (the honest verdict). **What's missing /
  where:** a TS implementation of `cmd.tenmol_seqview` (`rows`/`select`/
  `select_range`/`center`/`set_state`/`clear`/`menu`/`menu_expand`) in
  `packages/engine-ts`, mirroring `packages/bridge/tenmol_bridge/panels/seqview.py`.

- **settings (62 of 68) — GENUINE ENGINE-TS GAP.** Verified live: the settings
  windows open, but the body reads *"settings service unavailable:
  setting.tenmol_settings_status: not ported by @tenmol/engine-ts yet"*. The
  catalogue/values/scope tap (`setting.tenmol_settings_*`) is a bridge-only panel
  (`packages/bridge/tenmol_bridge/panels/settings.py`); engine-ts does not port
  it, so without a catalogue the Setting-menu tabs/rows, the Advanced table and
  the Lighting presets never render and every content spec times out on its setup
  selector. A stripped-tag re-run confirmed this end-to-end: **6 PASS / 62 FAIL**
  (the 6 that pass are exactly the panel/window open-close specs, already tagged
  local). The 62 content specs keep `remote-backend` and stay BLOCKED. **What's
  missing / where:** a TS implementation of the `setting.tenmol_settings_*`
  service in `packages/engine-ts`, mirroring
  `packages/bridge/tenmol_bridge/panels/settings.py`.
- **compute suite (ESP/SASA/force-fields)** — pure `pymol.util` math; portable to
  TS, unimplemented today but not a hard wall.
- **picking (34)** — WebGL raycast is feasible; the audit blocked it because the
  harness can't deterministically aim a 3-D atom click.

## Scope of the automated removal

Only bucket **A** is removed, via `scripts/migrate/plan/remove-impossible.json`,
executed through the crash-safe harness (`scripts/migrate/`). Bucket B is the
follow-up *implement* phase. Bucket C was **resolved**: only ray/render was truly
mis-tagged (re-tagged local, now 19 PASS / 1 BLOCKED); the sequence viewer and
the 62 settings content specs are genuine `@tenmol/engine-ts` port gaps (their
`cmd.tenmol_seqview` / `setting.tenmol_settings_*` data services are bridge-only
and "not ported yet"), so they correctly keep `remote-backend` and stay BLOCKED.
