# TestSpec schema — the audit's unit of coverage

A **TestSpec** is one testable UI affordance (a button, toggle, menu leaf, input,
keyboard shortcut, drag target …) expressed so `scripts/audit/driver.mjs` can
drive it and reach a PASS / FAIL / BLOCKED verdict with no human judgement.

```jsonc
{
  "id": "menu.file.open",            // stable, unique, dotted. area.thing.variant
  "feature": "menubar",              // owning feature dir / area
  "label": "File ▸ Open…",           // human label
  "kind": "menu-command",            // button|toggle|input|menu-command|menu-open|dialog|keyboard|drag|other
  "requires": [],                    // capability tags that must be present or -> BLOCKED
  "note": "opens the file-open dialog",   // expected behaviour, in words (for the visual judge + report)
  "needsVisual": false,              // true => a human/vision agent should eyeball the screenshot
  "setup":   [ /* actions to reach the precondition */ ],
  "trigger": [ /* the action(s) under test */ ],
  "checks":  [ /* objective expectations */ ],
  "settleMs": 400,                   // optional wait after trigger
  "allowPageError": false            // set true only if a page error is expected/benign
}
```

`noPageError` is auto-prepended to every spec's checks unless `allowPageError`.

## Actions (used in `setup` and `trigger`)

| action | fields | meaning |
|---|---|---|
| `cmd`     | `text` | type into the command line (`input.cmdline__input`) + Enter |
| `click`   | `selector`, `nth?` | click a CSS selector |
| `type`    | `selector`, `text`, `nth?` | fill an input |
| `press`   | `key`, `selector?`, `nth?` | press a key (optionally focused on selector) |
| `hover`   | `selector`, `nth?` | hover |
| `wait`    | `ms` | fixed wait |
| `waitFor` | `selector`, `ms?` | wait for a selector |
| `menu`    | `path: string[]` | open a menu-bar path, e.g. `["Display","Sequence","On"]`. A disabled leaf -> BLOCKED |

## Checks (all objective; evaluated from before/after evidence)

| check | fields | passes when |
|---|---|---|
| `noPageError`       | — | no uncaught page error fired during trigger (auto-added) |
| `noConsoleError`    | — | no new `console.error` |
| `noNetFailure`      | — | no new failed request / HTTP ≥400 |
| `feedbackMatches`   | `pattern` | visible text matches regex (case-insensitive) |
| `feedbackNotMatches`| `pattern` | newly-added visible text does NOT match regex (use for "unavailable\|cannot\|unknown\|error") |
| `selectorVisible`   | `selector` | element is visible (e.g. a dialog opened) |
| `selectorHidden`    | `selector` | element is not visible (e.g. dialog closed) |
| `domChanged`        | — | body text or viewport canvas changed |
| `screenshotChanged` | — | viewport canvas pixels changed (a render mutation) |

## Capability tags for `requires`

The runner is passed a `caps` set; a spec needing a tag not in `caps` is BLOCKED
(not FAIL) — it is untestable in this environment, not broken.

- `local-backend` — always present (default audit backend, in-browser TS engine)
- `webgl` — in-browser WebGL (present here via swiftshader)
- `remote-backend` — the WebSocket PyMOL bridge (absent unless a bridge is booted)
- `bridge-gl` — offscreen GL on the bridge: Mode P pixel render, backend picking (absent here)
- `file-service` — server-side file open/save (the "file service unavailable" surface)
- `network` — outbound internet (e.g. `fetch <pdbid>` from RCSB)

## Verdict semantics

- **PASS** — every check passed.
- **FAIL** — a control threw, logged an error, showed an error string, or did not
  produce its expected effect. This is a real defect to map.
- **BLOCKED** — a required capability was absent, or a menu leaf is intentionally
  disabled/unbuilt. Not a defect; recorded separately.
