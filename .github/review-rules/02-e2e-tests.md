# Rule: Add e2e tests where needed

End-to-end tests must be added (or updated) when a PR touches user-facing flows
or cross-layer interactions.

**When e2e tests are required:**
- New user-facing features (new screen, new modal, new workflow)
- Changes to the PyMOL WebSocket bridge that affect the viewer lifecycle
  (connect, load structure, rotate/zoom, color, select residues)
- Changes to how structures are loaded, rendered, or exported
- Any fix for a bug that was caught via manual QA (regression test)

**Scope:**
- Use the existing e2e framework in the repo (check `apps/webclient/e2e/` or `scripts/e2e/`)
- Cover the happy path at minimum; add an error path if the feature has notable failure modes

**Enforcement:**
If the diff adds/changes a user-facing feature or bridge interaction with no e2e coverage,
flag as 🟡 Major with a note on which flow needs a test.
