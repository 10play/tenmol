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

- **settings (62), sequence viewer (36)** — local-engine operations; the audit
  over-tagged them `remote-backend`. They should just be re-run locally.
- **ray / image render** — `engine-ts/src/cmd/render.ts` already raytraces in-browser;
  only Mode-P (the bridge's offscreen GL) is bridge-specific.
- **compute suite (ESP/SASA/force-fields)** — pure `pymol.util` math; portable to
  TS, unimplemented today but not a hard wall.
- **picking (34)** — WebGL raycast is feasible; the audit blocked it because the
  harness can't deterministically aim a 3-D atom click.

## Scope of the automated removal

Only bucket **A** is removed, via `scripts/migrate/plan/remove-impossible.json`,
executed through the crash-safe harness (`scripts/migrate/`). Bucket B is the
follow-up *implement* phase; bucket C just needs a local re-run of the audit with
corrected `requires` tags.
