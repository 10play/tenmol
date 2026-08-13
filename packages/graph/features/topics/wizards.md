---
name: wizards
kind: feature
category: wizard
subcategory: wizard machinery
summary: PyMOL's modal wizard surface — a stack of plain Python helper objects that draw declarative panel/prompt/menu descriptions in the internal GUI and receive pick/select/key events from the core.
parity: implemented
---

# Wizards

A **wizard** is a plain Python object living on a LIFO stack inside the C++ core
(`CWizard::Wiz`). It is not a widget: the core *pulls* a declarative panel, prompt,
event-mask and pop-up menu out of it by calling five render methods, and *pushes*
mouse/keyboard/scene events into it via ~11 `do_*` callbacks. Because the protocol is
implemented once, all bundled wizards plus the Builder wizards and any plugin wizard
render through the same generic renderer with no per-wizard client code.

This document covers every wizard module under
`packages/engine/modules/pymol/wizard/` and the `cmd.*_wizard` lifecycle command family
that drives them. Two names named in the task brief — `dssp` and `mapping` — have **no
wizard module in this codebase** and are therefore not documented.

Everything below is grounded in `docs/wizards.md`, which is itself read out of unmodified
upstream `packages/engine/` at `file:line`, plus the introspected command signatures in
`docs/api-reference/commands.mdx`.

---

## The protocol (base class)

`packages/engine/modules/pymol/wizard/__init__.py:4` — `class Wizard`. Every bundled
wizard subclasses it. The core calls it through two families of method.

**Render methods** (pulled by C on every `WizardRefresh`):

| Method | Returns |
|---|---|
| `get_prompt()` | `list[str]` or `None` — the top-left overlay text |
| `get_panel()` | `list[[int type, str text, str code]]` or `None` — the panel rows |
| `get_event_mask()` | `int` bitmask (default `pick+select` = 3) |
| `get_menu(tag)` | `list[[int code, str text, str\|list\|callable]]` or `None` — a pop-up |
| `cleanup()` | ignored — teardown hook run on pop |

**Event methods** (invoked via `WizardCallPython`, each guarded by a mask bit; all optional):

| Method | Mask bit |
|---|---|
| `do_pick(bondFlag)` | `event_mask_pick` = 1 |
| `do_select(name)` | `event_mask_select` = 2 |
| `do_key(k,x,y,mod)` | `event_mask_key` = 4 |
| `do_special(k,x,y,mod)` | `event_mask_special` = 8 |
| `do_scene()` | `event_mask_scene` = 16 |
| `do_state(state)` | `event_mask_state` = 32 |
| `do_frame(frame)` | `event_mask_frame` = 64 |
| `do_dirty()` | `event_mask_dirty` = 128 |
| `do_view()` | `event_mask_view` = 256 |
| `do_position()` | `event_mask_position` = 512 |

`do_pick_state(state)` fires just before `do_pick`/`do_select`, carrying a 1-based state
index of the picked object.

### Panel row format

Each panel row is `[type, text, code]`. `type` is `0` blank/spacer, `1` text label,
`2` button (runs `code` as a PyMOL command on release), `3` pop-up (calls `get_menu(code)`
on click). The `code` string is PyMOL command-language executed server-side by `PParse` —
almost always `cmd.get_wizard().<method>(...)` or `cmd.set_wizard()`. Panel and prompt text
carry inline `\RGB` color escapes (digits 0-9 → `d/9.0` float) and `\---` to reset.

### Lifecycle

Wizards form a **stack** — nested wizards are supported and a wizard can push another
(`openvr`, `demo`) or dismiss itself from an event handler (`dragging`). Per-wizard state
persists in `pymol.session.wizard_storage[class]` (exposed as `self.session`) and is saved
in the session file.

**Source:** `packages/engine/modules/pymol/wizard/__init__.py`;
`packages/engine/layer1/Wizard.cpp`; `docs/wizards.md` §0–§5.
Parity: the generic renderer is shipped —
`packages/bridge/tenmol_bridge/panels/wizards.py`,
`packages/protocol/src/topics/wizard.ts`, `apps/web/src/features/wizards/`; the stack/prompt
machine is also ported in `packages/engine-ts/src/cmd/wizards.ts`. `docs/feature-parity.md`
marks Wizards 32/32.

---

## Lifecycle commands

### wizard

## Purpose
Launch a built-in wizard by name, pushing it onto the wizard stack and refreshing the panel.
The single most common way a user or menu enters a wizard.

## Syntax
`wizard(name=None, *arg, **kwd)`

| Param | Type | Default | Meaning |
|---|---|---|---|
| `name` | str | `None` | wizard module name; `None` dismisses all (calls `set_wizard()`) |
| `*arg`, `**kwd` | | | forwarded to the wizard constructor |

## Behaviour
Imports `pymol.wizard.<name>`, instantiates class `<name>.capitalize()` with `_self=cmd`
injected, pushes it via `cmd.set_wizard`, then `refresh_wizard`. `name='distance'` is
rewritten to `'measurement'` (legacy alias). A constructor `TypeError` becomes
`CmdException`; a `WizardError` is swallowed and shown via a `Message` wizard.

## Examples
```
wizard measurement
wizard mutagenesis
wizard message, Hello there, dismiss=0
```

## Related
[set_wizard](#set_wizard), [replace_wizard](#replace_wizard), [refresh_wizard](#refresh_wizard)

## Source
`packages/engine/modules/pymol/wizarding.py:62`. Parity: implemented
(`packages/engine-ts/src/cmd/wizards.ts`).

### replace_wizard

Same as `wizard` but pops the current top first (`replace=1`) instead of stacking.
`replace_wizard(name=None)`. Used by every `demo.py` panel button
(`replace_wizard demo,<name>`). Documented in commands.mdx as an "unsupported internal
command". Source `packages/engine/modules/pymol/wizarding.py:94`. Parity: implemented.

### set_wizard

## Purpose
The low-level push/pop primitive. Pushes a wizard object, or with `wizard=None` pops and
runs the top's `cleanup()` — the canonical "Done" action every panel wires to
`cmd.set_wizard()`.

## Syntax
`set_wizard(wizard=None, replace=0)`

| Param | Type | Default | Meaning |
|---|---|---|---|
| `wizard` | object | `None` | wizard to push; `None` pops the top |
| `replace` | int | `0` | if set, pop the current top before pushing |

## Behaviour
If `wizard` is `None` or `replace` is set, pop the top and call its `cleanup()`; then if a
wizard was supplied, push it; finally `WizardRefresh`. It is a stack.

## Source
`packages/engine/modules/pymol/wizarding.py:110` → `WizardSet`. Parity: implemented.

### set_wizard_stack

Replace the entire wizard stack at once. `set_wizard_stack(stack=[])`. Used by session
restore. Source `wizarding.py:120`. Parity: implemented.

### get_wizard

Return the wizard at the top of the stack (or `None`). `get_wizard()`. Panel `code` strings
call it constantly (`cmd.get_wizard().<method>()`). Source `wizarding.py:156`. Parity:
implemented.

### get_wizard_stack

Return the full stack as a list (used by session save and to test nesting depth).
`get_wizard_stack()`. Source `wizarding.py:166`. Parity: implemented.

### refresh_wizard

Synchronously re-pull prompt + event mask + panel from the top wizard. Nearly every wizard
method ends with `self.cmd.refresh_wizard()`. `refresh_wizard()`. Documented in commands.mdx
as an "unsupported internal command". Source `wizarding.py:130` → `WizardRefresh`. Parity:
implemented.

### dirty_wizard

Set a flag so the *next* render pass does a refresh (deferred, feedback-safe). Used by
`annotation.py`. `dirty_wizard()`. Source `wizarding.py:146` → `WizardDirty`. Parity:
implemented.

---

## Bundled wizards

Launch names come from `name.capitalize()`, so `wizard pair_fit` → class `Pair_fit`. The
Wizard menubar (`_gui.py:834-864`) exposes: Appearance, Measurement, Mutagenesis (Protein |
Nucleic Acids), Pair Fitting, Density, Filter, Sculpting, Label, Charge, and Demo.

### measurement

## Purpose
Interactive distance / angle / dihedral / H-bond / neighbor measurements. Replaces the legacy
`distance` wizard.

## Syntax
`wizard measurement`

## Behaviour
Panel (6 rows): title, `mode` pop-up, `object_mode` pop-up, `Delete Last Object`,
`Delete All Measurements`, `Done`. `mode` menu offers Distances, Distances to Rings, Angles,
Dihedrals, Polar/Heavy/Neighbors, Polar Contacts; the three neighbor modes open a submenu
(all objects / in object▸ / in selection▸ / other objects / same object). `object_mode`:
Merge / Replace / Create New. State machine tracks how many atoms are picked (2 for
pairs/rings/hbond, 3 for angle, 4 for dihedral); neighbor modes are one-shot. Prompt wording
follows `mouse_selection_mode`. Event mask `pick|select|dirty`.
Drives `cmd.dist`/`distance`/`angle`/`dihedral`, `select`, `delete`, `enable`,
`get_setting_float` for the cutoffs, and persists a `measure%02d` counter in `self.session`.

## Examples
```
wizard measurement
```

## Related
[distance](#distance), [label](#label)

## Source
`packages/engine/modules/pymol/wizard/measurement.py`; `docs/wizards.md` §7.1. Parity:
implemented.

### mutagenesis

## Purpose
Swap a protein residue for a rotamer-library entry, with bump (strain) scoring and a live
preview object.

## Syntax
`wizard mutagenesis`

## Behaviour
Refuses to run inside a movie (raises `WizardError` → `Message` wizard). Panel (10 rows):
title, `mode` (residue to mutate), `n_cap`, `c_cap`, `hyd`, `rep`, `dep` pop-ups, `Apply`,
`Clear`, `Done`. `get_panel` forces `mouse_selection_mode=1` (residue) every refresh. The
`mode` menu lists every residue in `sc_bb_ind.pkl` plus protonation variants regrouped into
ARG…/LYS…/HIS…/GLU…/ASP… submenus. `do_library()` is the heavy lifter: fragment build,
`pair_fit` of CA/CB/C/N, backbone-dependent rotamer lookup with phi/psi binning, per-rotamer
`create`/`set_dihedral`/`set_title`, and bump checking via `sculpt_activate`/`sculpt_iterate`.
Event mask `pick|select|state`.

## Examples
```
wizard mutagenesis
```

## Related
[nucmutagenesis](#nucmutagenesis), [sculpting](#sculpting), [pair_fit](#pair_fit)

## Source
`packages/engine/modules/pymol/wizard/mutagenesis.py`; `docs/wizards.md` §7.2. Parity:
implemented.

### nucmutagenesis

## Purpose
The nucleic-acid counterpart of mutagenesis — mutate a base (A/C/G/T/U) transferring the
chi dihedral.

## Syntax
`wizard nucmutagenesis`

## Behaviour
Also refuses movies. Panel: title, `mode` (Adenine/Cytosine/Guanine/Thymine/Uracil),
`auto_center` ON/OFF, `rep`, `Apply`, `Clear`, `Done`; forces `mouse_selection_mode=1`.
`do_pick` rejects bonds then `do_select('byres pk1')`; the mutation removes the old base,
`fuse`s the new fragment, transfers the chi dihedral, and prefixes `resn` with `D` for DNA
(detected by absent `O2'`). Default event mask `pick|select`.

## Examples
```
wizard nucmutagenesis
```

## Related
[mutagenesis](#mutagenesis)

## Source
`packages/engine/modules/pymol/wizard/nucmutagenesis.py`; `docs/wizards.md` §7.3. Parity:
implemented.

### pair_fit

## Purpose
Superpose two objects by user-picked atom pairs.

## Syntax
`wizard pair_fit`

## Behaviour
Panel (no menus): title, `Fit N Pairs`, `Delete Last Pair`, `Redraw`, `Clear`, `Done`. State
alternates between "pick mobile atom" and "pick target atom"; mobiles must share one object,
targets a different one. Selections `_pf_s_%02db` (mobile) / `_pf_s_%02da` (target). `Fit`
runs `push_undo` then `pair_fit(*args)` and reports RMS. Dashes drawn with `dist(...)`.
Known upstream quirk: uses the module-level `cmd` rather than `self.cmd`, ignoring `_self`.

## Examples
```
wizard pair_fit
```

## Related
[measurement](#measurement), [mutagenesis](#mutagenesis)

## Source
`packages/engine/modules/pymol/wizard/pair_fit.py`; `docs/wizards.md` §7.4. Parity:
implemented.

### appearance

## Purpose
Click-to-restyle: a three-dropdown "verb / target / scope" machine bound to the Appearance
menubar entry.

## Syntax
`wizard appearance`

## Behaviour
Dynamic panel: title, a `mode` pop-up (Color, Color elem-c, Toggle, Show, Hide), then
depending on mode either a `color` pop-up (14 colors each with a `\RGB` swatch), a `what`
pop-up (Lines, Sticks, Cartoon, Surface, …), or a static Atoms row; then a `scope` pop-up
(By Atom/Residue/Chain/Segment/Object/Molecule) and `Done`. A pick synthesizes and runs a
command string `mode('what', '(scope pk1)')` via `self.cmd.do(..., log=0)`. Verbs are
`cmd.color`, `util.color_carbon`, `cmd.toggle`, `cmd.show`, `cmd.hide`. Choices persist
module-level, written back in `cleanup()`.

## Examples
```
wizard appearance
```

## Related
[label](#label), [charge](#charge)

## Source
`packages/engine/modules/pymol/wizard/appearance.py`; `docs/wizards.md` §7.5. Parity:
implemented.

### cleanup

## Purpose
Run OpenEye `szybki` on a ligand and pull the minimized coordinates back in.

## Syntax
`wizard cleanup`

## Behaviour
Hard external dependency: `__init__` searches `$OE_DIR`/`$OEDIR` for `bin/szybki` and raises
`CmdException` if not found, so the wizard never opens in this deployment. Panel: title,
`Run`, `Undo`, `Redo`, `Ligand:` pop-up (from `public_objects`), `Refresh`, `Done`. `run()`
saves the ligand to `.mol`, shells out to `szybki`, reloads the output, `fit`s it back, and
purges the sculpt state. Undo/redo keep object copies `_w_cleanup_undo/_redo`.

## Examples
```
wizard cleanup
```

## Related
[sculpting](#sculpting)

## Source
`packages/engine/modules/pymol/wizard/cleanup.py`; `docs/wizards.md` §7.6, §10. Parity:
partial — the generic renderer supports it but the wizard cannot open without an OpenEye
`szybki` binary.

### density

## Purpose
Roving isomesh around a picked atom/residue, up to three maps at once.

## Syntax
`wizard density`

## Behaviour
Panel (14 rows): title, `Update Maps`, `Zoom`, `Next Res. (PgDown)`, `Previous Res. (PgUp)`,
`Radius` pop-up (4–50 Å), three `Map N:`/`@ X sigma` pop-up pairs, a `track` pop-up
(Track & Zoom / Center / Set Origin / Off), `Done`. `get_panel` rebuilds the map menus each
refresh from live `object:map` objects. Binds PgUp/PgDn to step residues (unbound in
`cleanup`). Event mask `pick|select|position`; `do_position` re-runs `update_maps(zoom=0)`
when the camera center moves — the actual roving behaviour. `update_maps` issues
`isomesh(...)` per slot coloring blue/white/magenta, then zoom/center/origin per `track`.

## Examples
```
wizard density
```

## Related
[measurement](#measurement)

## Source
`packages/engine/modules/pymol/wizard/density.py`; `docs/wizards.md` §7.7. Parity:
implemented.

### filter

## Purpose
Triage a multi-state (docked-compound) object into Accept / Reject / Defer buckets.

## Syntax
`wizard filter`

## Behaviour
Panel (12 rows): title, `browse` pop-up (All/Accepted/Rejected/Deferred/Remaining),
`object` pop-up (molecules with >1 state), `Accept (F1)`, `Reject (F2)`, `Defer (F3)`,
`Forward (->)`, `Back (<-)`, `create` pop-up, `Save <obj>.txt`, `Refresh`, `Done`. Binds
F1/F2/F3 and arrow keys (restored in `cleanup`). Prompt shows the running tally and the
current state's verdict. `set_browse` drives the movie via `cmd.mset`; `save()` writes a TSV
report. Choices persist module-level; `migrate_session` remaps pre-1.7.0.0 dicts. Event mask
`pick|select|state`.

## Examples
```
wizard filter
```

## Related
[measurement](#measurement)

## Source
`packages/engine/modules/pymol/wizard/filter.py`; `docs/wizards.md` §7.8. Parity:
implemented.

### label

## Purpose
Click an atom to toggle a formatted label on it.

## Syntax
`wizard label`

## Behaviour
Panel: title, `mode` pop-up (9 python-format templates such as `{resn}-{resi}`,
`{one_letter}{resi}`, `{chain}/{resn}\`{resi}`), `Messages: On|Off`, `Done`. `do_select`
iterates the picked atom into `self.atom` and toggles: an already-labeled atom is cleared,
otherwise the template is formatted (one-letter code via `exporting._resn_to_aa`). Forces
`mouse_selection_mode=0` at construction. Event mask `pick|select`.

## Examples
```
wizard label
```

## Related
[appearance](#appearance), [measurement](#measurement)

## Source
`packages/engine/modules/pymol/wizard/label.py`; `docs/wizards.md` §7.9. Parity:
implemented.

### charge

## Purpose
Inspect, move, or zero `partial_charge` on atoms and residues.

## Syntax
`wizard charge`

## Behaviour
Panel: title, `mode` pop-up (Show, Add, Copy, Zero, Move & Zero atom/resi, Move & Remove
atom/resi, Get Total Charge), `Clear`, `Done`. Two-step source→destination picking for the
move modes. `get_prompt` has side effects: it prepends a "Total charge on the residue is …"
line by running `cmd.iterate("(byres wcharge)")`, so the renderer must not call it
speculatively. `do_pick` dispatches per mode via `iterate`/`alter`/`label`/`remove`/`select`.
Enters `edit_mode` at construction. Default event mask `pick|select`.

## Examples
```
wizard charge
```

## Related
[appearance](#appearance), [label](#label)

## Source
`packages/engine/modules/pymol/wizard/charge.py`; `docs/wizards.md` §7.10. Parity:
implemented.

### sculpting

## Purpose
Pick a center atom, auto-partition the object into free / fixed / excluded shells, and turn
on the real-time sculpting engine.

## Syntax
`wizard sculpting`

## Behaviour
Panel: title, `mode` pop-up (One Residue / Residue Shells), `Radius` pop-up (4–20 Å),
`Cushion` pop-up (2–12 Å), `Toggle Sculpting`, `Toggle Bumps`, `Relocate`, `Done`. The two
toggle rows carry raw inline Python in their `code` (e.g.
`cmd.set("sculpting", {"off":"on"}.get(cmd.get("sculpting"),0))`), proving panel code is a
general command string. Constructor forces `edit_mode(1)`, saves `sculpt_vdw_vis_mode`, and
deactivates any prior sculpt. `update_selections()` builds `sclpt_wz_free/fix/excl` via the
within operator, applies `protect`/`flag`/`mask`, and `sculpt_activate`s the object.
`cleanup` restores everything.

## Examples
```
wizard sculpting
```

## Related
[mutagenesis](#mutagenesis), [cleanup](#cleanup)

## Source
`packages/engine/modules/pymol/wizard/sculpting.py`; `docs/wizards.md` §7.11. Parity:
implemented.

### message

## Purpose
The generic modal notice. The error path of `cmd.wizard` uses it to surface a `WizardError`.

## Syntax
`wizard message, <text>, dismiss=<0|1>`

## Behaviour
`Message(*arg, dismiss=1)` — positional args are flattened into prompt lines and echoed to
the console with `\RGB` codes stripped. With `dismiss=1` the panel is title + `Dismiss`;
with `dismiss=0` the panel is empty (`[]`) — a prompt-only overlay with no buttons.

## Examples
```
wizard message, Please wait while the example loads..., dismiss=0
wizard message, Done!
```

## Related
[wizard](#wizard), [security](#security)

## Source
`packages/engine/modules/pymol/wizard/message.py`; `docs/wizards.md` §7.12. Parity:
implemented.

### demo

## Purpose
The built-in feature tour — a menu of self-running demonstrations.

## Syntax
`wizard demo` or `wizard demo, <name>`

## Behaviour
Panel (13 rows), each a `replace_wizard demo,<name>`: Representations, Cartoon Ribbons,
Roving Detail, Roving Density, Transparency, Ray Tracing, Sculpting, Scripted Animation,
Electrostatics, CGOs, Molscript/R3D Input, End Demonstration. No menus; the prompt is a hint
string. A named launch first tears down the previous demo, then runs the new demo body on a
daemon thread. Demo bodies are pure `cmd` scripts loading assets from `$PYMOL_DATA/demo`.

## Examples
```
wizard demo
wizard demo, cartoon
```

## Related
[stereodemo](#stereodemo), [benchmark](#benchmark)

## Source
`packages/engine/modules/pymol/wizard/demo.py`; `docs/wizards.md` §7.13. Parity: implemented.

### stereodemo

## Purpose
The "kiosk" demo used for stereo hardware, with sectioned category headers.

## Syntax
`wizard stereodemo` or `wizard stereodemo, <name>[, mono]`

## Behaviour
Panel (16 rows) with five `[1,…]` section headers (Structural Biology, Drug Discovery,
Presentation Graphics, Bioinformatics, Science Education, Configuration) grouping buttons
plus Toggle Fullscreen / Toggle Stereo 3D. Constructor forces fullscreen off and stereo on
(unless `mono`), then launches a demo. Demo bodies load `.pse` sessions on a daemon thread.

## Examples
```
wizard stereodemo
wizard stereodemo, medchem, mono
```

## Related
[demo](#demo)

## Source
`packages/engine/modules/pymol/wizard/stereodemo.py`; `docs/wizards.md` §7.14. Parity:
implemented.

### benchmark

## Purpose
Measure the local GL blit and raytrace throughput.

## Syntax
`wizard benchmark`

## Behaviour
Panel (17 rows): Run All / Run GL / Run CPU, then per-test buttons (Updates, Smooth/Jagged
Lines, Dots, Sticks, Surface, Spheres, Cartoon, Blits, Surface/Mesh Calculation, Ray
Tracing, End). Every button calls `delay_launch(name)`, which `reinitialize()`s, sets a
640×480 viewport, disables feedback, and runs on a daemon thread; results go to stdout.

## Examples
```
wizard benchmark
```

## Related
[demo](#demo)

## Source
`packages/engine/modules/pymol/wizard/benchmark.py`; `docs/wizards.md` §7.15, §10. Parity:
partial — the numbers describe the bridge's offscreen GL context, not the browser viewport.

### box

## Purpose
Draw an editable CGO box / plane / wall / quad from four draggable pseudo-atoms.

## Syntax
`wizard box`

## Behaviour
Panel: title, `mode` pop-up (Box/Walls/Plane/Quad), `Change Name`, `Copy Box`, `Toggle
Points`, `Auto-Position (50%)`, `Auto-Position (99%)`, `Done`. `Change Name` enters an inline
text-input sub-state that flips the event mask to include `key` and swaps the prompt to a
hand-rolled line editor (`do_key` handles backspace/printable/Enter). Event mask always
includes `scene`; `do_scene` diffs the four pseudo-atom coordinates and rebuilds the CGO when
they move. `do_pick` is an explicit no-op.

## Examples
```
wizard box
```

## Related
[pseudoatom](#pseudoatom), [renaming](#renaming)

## Source
`packages/engine/modules/pymol/wizard/box.py`; `docs/wizards.md` §7.16. Parity: implemented.

### command

## Purpose
A generic wizard that introspects any PyMOL command and renders one pop-up row per keyword
argument — the closest existing analogue to the generic contract.

## Syntax
`wizard command`

## Behaviour
Three panel shapes: no command chosen (`Select a command...` pop-up), text-input active
(Apply/Cancel), or normal (`<Command> Wizard` title + one `<arg>: <value>` row per parameter
+ `Run` + `Done`). `get_menu` is overridden: the magic tag `_commands` returns the full
keyword list, otherwise it splices live `cmd.auto_arg` completions. Introspects via
`inspect.signature`, stopping at the first non-`POSITIONAL_OR_KEYWORD` param and skipping
`_`-prefixed and `quiet`. Stores itself on `pymol.stored` to break the reference cycle.

## Examples
```
wizard command
```

## Related
[wizard](#wizard)

## Source
`packages/engine/modules/pymol/wizard/command.py`; `docs/wizards.md` §7.17. Parity:
implemented.

### distance

## Purpose
The legacy distance/angle measurement wizard, superseded by `measurement`.

## Syntax
`wizard distance` (rewritten to `measurement`)

## Behaviour
`cmd.wizard("distance")` is rewritten to `measurement` at `wizarding.py:88-89`, so this
module is effectively unreachable via `cmd.wizard`. Panel: title, `mode` pop-up (Polar/Heavy/
Neighbors/Pairwise), `object_mode` pop-up (Replace/Create New), Delete Last, Delete All,
Done. Objects named `dist%02d`. Kept only for API/session compatibility.

## Examples
```
wizard measurement
```

## Related
[measurement](#measurement)

## Source
`packages/engine/modules/pymol/wizard/distance.py`; `docs/wizards.md` §7.18, §10. Parity:
internal — dead by upstream's own rewrite; retained for session compatibility only.

### dragging

## Purpose
The panel shown while the mouse is in the "drag" editor scheme.

## Syntax
Auto-launched by the editor drag scheme (not typically invoked by name).

## Behaviour
Two panel shapes: dragging atoms (Undo/Redo/Indicate/Done) or dragging an object matrix
(Reset/Done). `get_panel` may return `None` when the wizard has gone invalid — the renderer
must tolerate `None`/`[]`. `check_valid()` polls `get_editor_scheme() != 3` and dismisses
itself via `cmd.do("_ cmd.set_wizard()")`, demonstrating self-dismissal from an event handler.
Event mask `pick|dirty`. `cleanup` calls `cmd.drag()` and restores the button mode.

## Examples
```
edit_mode
```

## Related
[sculpting](#sculpting)

## Source
`packages/engine/modules/pymol/wizard/dragging.py`; `docs/wizards.md` §7.19. Parity:
implemented.

### openvr

## Purpose
The in-headset VR menu, launched automatically when stereo mode switches to OpenVR.

## Syntax
`wizard openvr` (normally issued by the core on stereo=OpenVR)

## Behaviour
Purely declarative — assigns `self.panel` directly (relying on the base `get_panel`):
title, `Scene`, `Wizard`, `VR GUI` pop-ups. The `Scene` menu has a nested F1–F12 store
submenu; the `Wizard` menu launches other wizards (a wizard that pushes wizards); the `VR
GUI` menu applies `openvr_gui_*` presets.

## Examples
```
wizard openvr
```

## Related
[demo](#demo)

## Source
`packages/engine/modules/pymol/wizard/openvr.py`; `docs/wizards.md` §7.20, §10. Parity:
partial — launched only by an OpenVR stereo path that does not exist in this deployment.

### annotation

## Purpose
Show per-state SD-file annotations as a prompt overlay.

## Syntax
`wizard annotation`

## Behaviour
No picking at all — event mask `scene|state|frame`, and each `do_scene`/`do_frame`/`do_state`
just calls `dirty_wizard()` to force a refresh on the next update pass. `get_prompt` reads
`pymol.session.annotation[obj][state]` for every enabled object. Companion loader
`load_annotated_sdf` parses an SD file and stores colored annotation lines. Panel: title,
`Dismiss`.

## Examples
```
wizard annotation
```

## Related
[message](#message), [filter](#filter)

## Source
`packages/engine/modules/pymol/wizard/annotation.py`; `docs/wizards.md` §7.21. Parity:
implemented.

### pseudoatom

## Purpose
Inline text entry to create a labeled pseudoatom at a 3D position. Launched from the viewport
context menu.

## Syntax
`wizard pseudoatom, label, pos=[x,y,z]`

## Behaviour
Panel is a single `Cancel` row (no title). Prompt is `Label text: <text>_` with a fake caret.
Event mask `key` only; `do_key` implements a line editor (backspace/escape/space/printable/
Enter) and on commit runs `cmd.pseudoatom(name, pos=…, label=…)` then `set_wizard()`.

## Examples
```
wizard pseudoatom, label, pos=[10,5,3]
```

## Related
[label](#label), [renaming](#renaming)

## Source
`packages/engine/modules/pymol/wizard/pseudoatom.py`; `docs/wizards.md` §7.22. Parity:
implemented.

### renaming

## Purpose
Inline rename of an object / selection / group / scene, launched from ~10 context-menu sites.

## Syntax
`wizard renaming` (constructed as `Renaming(old_name, mode='object')`)

## Behaviour
Panel: title, `Cancel`. Prompt `Renaming <old> to: <new>_`. Event mask `key` only; `do_key`
maps space→`_` and on Enter runs `set_name <old>,<new>` (object mode) or
`scene <old>,rename,new_key=<new>` (scene mode). Uses module-level `cmd`.

## Examples
```
wizard renaming
```

## Related
[pseudoatom](#pseudoatom), [box](#box)

## Source
`packages/engine/modules/pymol/wizard/renaming.py`; `docs/wizards.md` §7.23. Parity:
implemented.

### security

## Purpose
The "this session file contains movie/python commands" consent gate.

## Syntax
`wizard security` (raised by session load when a file carries movie commands)

## Behaviour
Prompt is a fixed multi-line warning block, also echoed to the console. Panel: title,
`accept` (`cmd.accept()`), a spacer, `decline` (`cmd.decline()`), a spacer, `mdump`
(`cmd.mdump()`). The empty `[1,'','']` spacer rows must reserve vertical space in the renderer.

## Examples
```
load risky.pse
```

## Related
[message](#message)

## Source
`packages/engine/modules/pymol/wizard/security.py`; `docs/wizards.md` §7.24. Parity:
implemented.

### toggle

## Purpose
Kiosk-style fullscreen/stereo toggles plus an optional message overlay.

## Syntax
`wizard toggle`

## Behaviour
Panel: `Toggle Fullscreen`, `Toggle Stereo 3D`, `Toggle Message`, `Dismiss`. The panel is
edited in place — when there is no message the Toggle-Message row is deleted. Known upstream
quirk: `__init__` never calls `Wizard.__init__`, so `self.cmd`/`self.menu`/`self.session` do
not exist and it falls back to the module-level `cmd`; a generic bridge must not assume
`wiz.cmd` exists.

## Examples
```
wizard toggle
```

## Related
[stereodemo](#stereodemo), [message](#message)

## Source
`packages/engine/modules/pymol/wizard/toggle.py`; `docs/wizards.md` §7.25. Parity:
implemented.
