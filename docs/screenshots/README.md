# `docs/screenshots/` — what is in here, and what still points at it

95 PNGs, **12.99 MB — 91 % of all 14.25 MB of `docs/`**. Every `.md` in `docs/` put together,
including the 316 KB parity inventory, is the other 1.26 MB. This file is the inventory, because
without one nobody can tell an image that is load-bearing evidence from an image that was a
wave's throwaway proof.

Nothing here is deleted. **Removal is a recommendation only** — see the last section.

## The three groups

| group | files | size | added by | referenced today? |
| --- | ---: | ---: | --- | --- |
| [`modeg/`](./modeg/) | 48 | 3.97 MB | `f0f8a599` (44) + `48f62e7c` (4) | **YES.** `packages/viewport/src/webgl/mesh.ts:6` and `builder.ts:13` both send the reader here by name, and [`modeg/README.md`](./modeg/README.md) captions every file with its IoU / dE measurement. |
| `wave4/` | 21 | 3.95 MB | mostly `e4e42aa2` and `3bf2e01d` | **0 of 21.** These were cited by the parity inventory's per-wave annotations, which were removed when it was rewritten as a reference. `grep -rn 'wave4/'` across the repo now returns nothing outside this file. |
| top level | 26 | 5.06 MB | `c969b5fa` (the 11 numbered ones) plus one-per-commit proofs | **0 of 26.** Not one is named by any file in the repo. |

Method, so it can be re-run rather than believed: every `.png` basename was searched for across
all 2,128 text files in the tree outside `node_modules`, `.git`, `build`, `.venv`, `dist` and
`.deps`. **4 of 95 images are named anywhere.** `modeg/` is the exception that matters — its 48
files are addressed as a *directory* from two shipped source files and captioned individually by
its own README, so "not named" does not mean "orphaned" there.

## What the unreferenced images actually are

They are per-commit verification evidence: the screenshot an agent took to prove the thing it had
just built worked, attached to the commit that built it. Each was real proof of a real claim on
the day it was taken. None of them is cited by a document that survives, and the claims they
proved are now covered by the 21 e2e specs (`node apps/web/e2e/run.mjs`), which re-prove them on
every run instead of once.

| top-level file(s) | the commit's claim |
| --- | --- |
| `01-app-connected` … `09-modeG-instances` (11) | `c969b5fa` "working web viewport in both render modes" — connect, fragment, 1UBQ cartoon, drag, hide/show, and the same five in Mode G |
| `no-gl.png` | `360032d4` "narrow the GL-free blocker, and pin the no-GL contract" |
| `no-gl-pulloff.png` | `964c7134` "GL-free operation works; my previous claim was wrong" |
| `menubar.png` | `995c2778` "verify the menu bar independently, tick two rows" |
| `seqview.png` | `3bf2e01d` "sequence viewer cells collapsed to 1px" |
| `apbs-stub.png` | `9d95971f` "visible APBS stub" |
| `builder.png` | `db967c7b` "verify the builder builds a real molecule" |
| `colors.png` | `f2329329` "land the 13-slot parity wave" |
| `compute-panel.png` | `71513dc2` "compute panel for the util helpers" |
| `files-panel.png` | `3f7ee374` "verify File > Open end to end through the path picker" |
| `layout-overlap.png` | `1d7f5851` "overlay panels were burying the viewport" |
| `plugin-manager.png` | `77c87408` "read-only Plugin Manager" |
| `render-dialog.png` | `ad5fd853` "Draw/Ray render dialog, and fix the e2e origin bug" |
| `settings-editor.png`, `settings-panel.png` | `22becf9a` "stop wrapping overlay panels; verify the settings table" |
| `wizard.png` | `68b8de26` "verify the generic wizard renderer" |

## Recommendation — NOT APPLIED, needs the owner's decision

**Keep `modeg/` in full (3.97 MB).** It is the only group with a caption file, the only group
whose images carry measurements that exist nowhere else (IoU and mean dE, per rep, against
Mode P), and the only group two shipped source files point at.

**Nothing in `wave4/` is cited any more.** The two citations this section used to protect lived in
the parity inventory's per-wave annotations and went with them. Recorded rather than acted on: the
owner has asked to be consulted before files are deleted.

**Candidates for removal: 45 files, 8.59 MB** — the 26 top-level PNGs (5.06 MB) and 19 of the 21
in `wave4/` (3.53 MB). That is **66 % of `docs/screenshots/` and 60 % of all of `docs/`.**
The argument for removing them is that nothing reads them and the e2e suite re-proves the same
behaviour continuously. The argument against is that they are git history either way — deleting
them from the working tree does not shrink the clone, only the checkout — so the gain is
tidiness, not bytes on disk.

If they go, delete them in one commit with this file updated in the same commit, and check
`grep -rn "screenshots/" --include='*.md' --include='*.ts' --include='*.mjs' .` first; the
citation set is small and changes rarely, but it does change.
