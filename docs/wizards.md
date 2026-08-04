# Wizards — the PyMOL wizard surface

Map of PyMOL's wizard machinery. Scope: `packages/engine/modules/pymol/wizard/` (every file),
`packages/engine/modules/pymol/wizarding.py`,
`packages/engine/layer1/Wizard.{h,cpp}`, the wizard prompt renderer in `packages/engine/layer1/Ortho.cpp`, the pop-up menu
renderer in `packages/engine/layer4/PopUp.cpp`, wizard event dispatch sites in `packages/engine/layer1/SceneMouse.cpp`,
`packages/engine/layer3/Seeker.cpp`, `packages/engine/layer3/Executive.cpp`, `packages/engine/layer5/PyMOL.cpp`, and the Wizard menubar in
`packages/engine/modules/pymol/_gui.py`.

Everything below is grounded in `file:line` read out of `packages/engine/`, which is unmodified
upstream. Where something could not be found, the text says so.

**Where the port stands.** The protocol described here is implemented and shipping:
`packages/bridge/tenmol_bridge/panels/wizards.py` (snapshot/menu/event/exec, mask gating,
callable-submenu resolution), `packages/protocol/src/topics/wizard.ts` (wire shapes),
`apps/web/src/features/wizards/` (`WizardPanel`, `WizardPrompt`, `WizardPopupMenu`,
`WizardKeyCapture`, `ColorCodedText`, `service.ts`, `useWizard.ts`).

---

## 0. TL;DR

A wizard is a **plain Python object** living on a stack inside the C++ core
(`CWizard::Wiz`, `packages/engine/layer1/Wizard.cpp:69`). It is *not* a widget. The C++ core pulls a
**declarative panel description** and a **declarative prompt** out of it by calling five
Python methods, and pushes **events** into it by calling ~10 more.

That is why there is no per-wizard code in the port: the *protocol* is implemented once
(`<WizardPanel/>` + `<WizardPrompt/>` + `<WizardPopupMenu/>`), and all 26 bundled wizards —
plus the builder wizards in `packages/engine/modules/pmg_qt/builder.py` and any third-party
plugin wizard — render through it.

The five "render" methods (confirmed against source):

| Method | Called from | Returns |
|---|---|---|
| `get_prompt()` | `packages/engine/layer1/Wizard.cpp:205` | `list[str]` or `None` |
| `get_panel()` | `packages/engine/layer1/Wizard.cpp:227` | `list[[int type, str text, str code]]` or `None` |
| `get_event_mask()` | `packages/engine/layer1/Wizard.cpp:220` | `int` bitmask |
| `get_menu(tag)` | `packages/engine/layer1/Wizard.cpp:501` | `list[[int code, str text, str|list|callable]]` or `None` |
| `cleanup()` | `packages/engine/layer1/Wizard.cpp:275` | ignored |

The event methods (all invoked via `WizardCallPython`, which first does
`PyObject_HasAttrString` — `packages/engine/layer1/Wizard.cpp:162` — so **every method is optional**):

| Method | C entry point | Guarded by mask bit |
|---|---|---|
| `do_pick(bondFlag:int)` | `WizardDoPick`, `packages/engine/layer1/Wizard.cpp:303` | `cWizEventPick` = 1 |
| `do_pick_state(state:int)` | `packages/engine/layer1/Wizard.cpp:324` and `:189` | (rides on pick/select) |
| `do_select(name:str)` | `WizardDoSelect`, `packages/engine/layer1/Wizard.cpp:172` | `cWizEventSelect` = 2 |
| `do_key(k,x,y,mod)` | `WizardDoKey`, `packages/engine/layer1/Wizard.cpp:328` | `cWizEventKey` = 4 |
| `do_special(k,x,y,mod)` | `WizardDoSpecial`, `packages/engine/layer1/Wizard.cpp:462` | `cWizEventSpecial` = 8 |
| `do_scene()` | `WizardDoScene`, `packages/engine/layer1/Wizard.cpp:396` | `cWizEventScene` = 16 |
| `do_state(state:int)` | `WizardDoState`, `packages/engine/layer1/Wizard.cpp:428` | `cWizEventState` = 32 |
| `do_frame(frame:int)` | `WizardDoFrame`, `packages/engine/layer1/Wizard.cpp:445` | `cWizEventFrame` = 64 |
| `do_dirty()` | `WizardDoDirty`, `packages/engine/layer1/Wizard.cpp:412` | `cWizEventDirty` = 128 |
| `do_view()` | `WizardDoView`, `packages/engine/layer1/Wizard.cpp:371` | `cWizEventView` = 256 |
| `do_position()` | `WizardDoPosition`, `packages/engine/layer1/Wizard.cpp:344` | `cWizEventPosition` = 512 |

Python-side mirror of the mask constants: `packages/engine/modules/pymol/wizard/__init__.py:6-15`.
C-side mirror: `packages/engine/layer1/Wizard.cpp:49-58`. They agree exactly.

---

## 1. The base class

`packages/engine/modules/pymol/wizard/__init__.py:4` — `class Wizard`.

```
event_mask_pick     = 1     # __init__.py:6
event_mask_select   = 2     # :7
event_mask_key      = 4     # :8
event_mask_special  = 8     # :9
event_mask_scene    = 16    # :10   scene changed
event_mask_state    = 32    # :11   state changed
event_mask_frame    = 64    # :12   frame changed
event_mask_dirty    = 128   # :13   anything changed (BEWARE FEEDBACK!)
event_mask_view     = 256   # :14   view (matrix) changed
event_mask_position = 512   # :15   center of the view changed
```

- `__init__(self, _self=cmd)` — `:22`. Sets `self.menu = {}`, `self.prompt = None`,
  `self.panel = None`, `self.cmd = _self`, then `self._validate_instance()`.
  Because `get_panel()` (`:52`) defaults to `return self.panel` and `get_prompt()` (`:49`)
  defaults to `return self.prompt`, a wizard can be *purely declarative* by just assigning
  `self.panel` — this is exactly what `openvr.py:92-97` does.
- `_validate_instance()` — `:38`. Creates `pymol.session.wizard_storage[str(self.__class__)]`
  and exposes it as `self.session`. This is the **per-wizard-class persistence dict that
  survives across wizard launches and is saved in the session file.** `measurement.py:70`
  (`default_mode`), `:87` (`default_object_mode`), `:142` (`meas_count`) use it.
- `__getstate__` — `:29`: strips `cmd` before pickling. `__reduce__` — `:34`.
- `migrate_session(version)` — `:17`; only `filter.py:28` overrides it.
- `get_event_mask()` default — `:56`: `pick + select` (= 3).
- `get_menu(tag)` default — `:91`: dict lookup in `self.menu`.
- All `do_*` defaults return `None` (`:58-86`), `cleanup()` is a no-op (`:88`).

### Session persistence

`packages/engine/modules/pymol/wizarding.py:176` `session_save_wizard` double-pickles
`cmd.get_wizard_stack()` into `session['wizard']`.
`:182` `session_restore_wizard` unpickles with `chempy.io.pkl`, reattaches `wiz.cmd = _self`,
calls `wiz.migrate_session(version)`, then `cmd.set_wizard_stack(wizards)`.
Registered as session tasks in `packages/engine/modules/pymol/cmd.py:50-54`.

---

## 2. The panel wire format (`get_panel`)

Parsed in `packages/engine/layer1/Wizard.cpp:227-252`. Each element must be a list of **≥3 items**
(`:241`), and only the first three are read:

```
[0] int  type    -> I->Line[a].type   (:242)
[1] str  text    -> I->Line[a].text   (:243, truncated to sizeof(WordType)-1)
[2] str  code    -> I->Line[a].code   (:245, truncated to sizeof(OrthoLineType)-1)
```

Types (`packages/engine/layer1/Wizard.cpp:44-47`):

| value | constant | rendering (`CWizard::draw`, `:685`) | click behaviour |
|---|---|---|---|
| `0` | `cWizBlank` | nothing (falls through `default:` at `:771`) | none |
| `1` | `cWizTypeText` | flat text in `text_color2` (`:752-755`) | none |
| `2` | `cWizTypeButton` | raised button, dim grey fill (`:756-763`) | `PLog` + `PParse(code)` on **release** (`:571-577`) |
| `3` | `cWizTypePopUp` | raised button, blue-lavender fill (`:764-770`) | `get_menu(code)` + `PopUpNew` on **click** (`:495-511`) |

Panel height = `internal_gui_control_size * NLine + 4` via `OrthoReshapeWizard`
(`packages/engine/layer1/Wizard.cpp:254-259`); 0 lines → panel collapses to height 0 (`:258`).
`OrthoReshapeWizard` itself: `packages/engine/layer1/Ortho.cpp:2464`. Layout position (between the
Executive/object panel and the ButMode panel): `packages/engine/layer1/Ortho.cpp:2286-2300`.

Interaction detail worth cloning: pressing a button *highlights* it while held
(`I->Pressed`, `packages/engine/layer1/Wizard.cpp:490-494`), drag-off cancels the highlight
(`CWizard::drag`, `:519-548`), and the command only fires on **release inside the row**
(`:568-580`). React: `onPointerDown` sets pressed, `onPointerUp` inside fires.

**The `code` string is PyMOL command-language, executed by `PParse` server-side**
(`packages/engine/layer1/Wizard.cpp:575`). It is *not* JavaScript and must never be evaluated client-side.
In practice it is almost always `cmd.get_wizard().<method>(...)`, `cmd.set_wizard()`,
`replace_wizard demo,reps` (`demo.py:42`), or a raw command string
(`sculpting.py:175`: `cmd.set("sculpting",{"off":"on"}.get(cmd.get("sculpting"),0))`).

### Text markup

Both panel text and prompt text carry inline color codes `\RGB` where R,G,B are digits
0-9 mapped to `d/9.0` floats, plus `\---` = reset to default color.
Implementation: `TextStartsWithColorCode` `packages/engine/layer1/Text.cpp:507`, `TextSetColorFromCode`
`packages/engine/layer1/Text.cpp:530`. Consumers: `Wizard.cpp:670-681` (`draw_text`),
`Ortho.cpp:2165` and `:2237` (prompt), `PopUp.cpp:194` (menu width calc).
Live users: `cleanup.py:133` `"\\999Ligand:\\000 "`, `appearance.py:39-52`
(`'\\900red'`…), `command.py:146`, `renaming.py:12`, `pseudoatom.py:13`,
`annotation.py:86-93`. `message.py:7` even has a regex `_nuke_color_re` to strip them
for console echo.

Ported as the shared `\RGB` parser in `apps/web/src/features/wizards/colorCodes.ts`, rendered by
`apps/web/src/features/wizards/ColorCodedText.tsx`.

---

## 3. The prompt wire format (`get_prompt`)

`WizardRefresh` calls `get_prompt()` (`packages/engine/layer1/Wizard.cpp:205`), converts the returned list
to a NUL-separated char VLA (`PConvPyListToStringVLA`, `:207`) and hands it to
`OrthoSetWizardPrompt` (`packages/engine/layer1/Ortho.cpp:314`).

Rendered by `OrthoDrawWizardPrompt` — `packages/engine/layer1/Ortho.cpp:2124`. Behaviour driven by the
global setting `wizard_prompt_mode` (`packages/engine/layer1/SettingInfo.h:461`, default `1`):

- `0` → prompt suppressed entirely (`Ortho.cpp:2142`).
- `1` → text **plus opaque backdrop rectangle** in `WizardBackColor` (0.2,0.2,0.2 —
  `Ortho.cpp:2692-2694`); `Ortho.cpp:2193-2218`.
- `2` → text only, no backdrop, still offset by `cWizardTopMargin`/`cWizardLeftMargin`
  (15/15, `Ortho.cpp:200-201`).
- `3` → text only, flush to top-left (`rect.top -= 1; rect.left = 1`, `Ortho.cpp:2186-2190`).

Default text color `WizardTextColor` = (0.2, 1.0, 0.2) — `Ortho.cpp:2695-2697`; forced to
black when `internal_gui_mode != Default` (`Ortho.cpp:2145`).
The prompt is anchored to the top-left of the viewport and shifted down by the sequence
viewer height when the seq viewer is on top (`Ortho.cpp:2180-2184`).
It is drawn twice — once in `Ortho.cpp:2022`, once in `Scene.cpp:3463` with the comment
"ugly hack necessitated because wizard…". React only needs one overlay.

---

## 4. The pop-up menu wire format (`get_menu`)

`CWizard::click` on a type-3 row calls `get_menu(code)` with the row's `code` as the tag
(`packages/engine/layer1/Wizard.cpp:501`), and if non-`None` opens `PopUpNew(G, x, my, x, y, false, menuList, nullptr)`
(`:507`).

Parsed in `packages/engine/layer4/PopUp.cpp:231-248`:

```
[0] int code   (:233)
[1] str text   (:237)  -- skipped when code==0
[2] str | list | callable  (:241-247) -- skipped when code==2
```

Item codes:

| code | meaning | height const (`PopUp.cpp:293-320`) |
|---|---|---|
| `0` | separator bar (text and command ignored) | `cPopUpBarHeight` |
| `1` | selectable item | `cPopUpLineHeight` |
| `2` | non-selectable title/header | `cPopUpTitleHeight` |

Third element semantics:
- **`str`** → a PyMOL command; on release `PLog` + `PParse` (`PopUp.cpp:471-473`).
- **`list`** → nested submenu (`I->Sub[a]`, `:247`); opens on hover/click (`:459`).
- **callable** → *lazy* submenu. `SubGetItem` (`PopUp.cpp:88-105`) detects a non-list, calls
  it with no arguments, memoises the result in place. The bridge replicates this in
  `panels/wizards.py::_encode_menu`: a menu payload can only be serialized after resolving
  callables.

Real menus in the tree cover all three shapes: nested list submenus in
`mutagenesis.py:130-133` (ARG…/LYS…/HIS… grouped rotamer submenus), `openvr.py:15-29`
("Store…" → F1..F12), `measurement.py:130-137` (`neighbor_submenu`, whose entries 133/134
are themselves lists built eagerly from `get_names`). I did **not** find a wizard in
`packages/engine/modules/pymol/wizard/` that uses the *callable* form — that path is exercised by
`packages/engine/modules/pymol/menu.py`. Honest caveat: the bridge still must handle it because
`get_menu` is user-extensible.

Note `command.py:87` overrides `get_menu` itself (does not just read `self.menu`) and
regenerates values from `cmd.auto_arg` shortcuts on every open (`:100-103`) — proof that
`get_menu` must be **called on demand, per open**, never cached from a snapshot.

---

## 5. Lifecycle & refresh

- `cmd.wizard(name, *arg, **kwd)` — `packages/engine/modules/pymol/wizarding.py:62`. Legacy alias:
  `name == 'distance'` is rewritten to `'measurement'` (`:88-89`). `name=None` →
  `set_wizard()` (dismiss all, `:83-85`).
- `_wizard()` — `wizarding.py:30`: `__import__('pymol.wizard.'+name)` (`:35`), class name is
  `name.capitalize()` (`:41`), instantiated with `_self=cmd` injected into kwargs (`:44-46`).
  A `TypeError` becomes `pymol.CmdException` (`:47-49`); a `WizardError`
  (`wizarding.py:27`) is swallowed and replaced by a `Message` wizard showing the error
  (`:50-52`). Then `cmd.set_wizard(wiz, replace)` and `cmd.do("_ refresh_wizard")` (`:54-55`).
- `cmd.replace_wizard(...)` — `wizarding.py:94`, same but `replace=1`. Used by `demo.py:42-53`.
- `cmd.set_wizard(wizard=None, replace=0)` — `wizarding.py:110` → `_cmd.set_wizard`
  → `CmdSetWizard` `packages/engine/layer4/Cmd.cpp:2801` → `WizardSet` `packages/engine/layer1/Wizard.cpp:264`.
  Push/pop semantics: if `wiz` is `None`/`Py_None` **or** `replace` is set, pop the top and
  call its `cleanup()` (`:268-279`); then if a wizard was supplied, push it (`:280-282`);
  finally `WizardRefresh` (`:283`). **It is a stack** — nested wizards are supported.
- `cmd.get_wizard()` — `wizarding.py:156` → `WizardGet` `Wizard.cpp:784` (top of stack).
- `cmd.get_wizard_stack()` / `cmd.set_wizard_stack()` — `wizarding.py:166` / `:120`
  → `Wizard.cpp:791` / `:805`.
- `cmd.refresh_wizard()` — `wizarding.py:130` → `WizardRefresh` `Wizard.cpp:195`.
  **Synchronous re-pull of prompt + event mask + panel.** Nearly every wizard method ends
  with this call.
- `cmd.dirty_wizard()` — `wizarding.py:146` → `WizardDirty` `Wizard.cpp:94`: sets a flag so
  the *next* `WizardUpdate` (`:101`) does a refresh. Used by `annotation.py:11,14,17`.
- `WizardUpdate` (`Wizard.cpp:101`) runs once per render pass from `ExecutiveDrawNow`
  (`packages/engine/layer3/Executive.cpp:11555`) and additionally fires `do_dirty` / `do_frame` / `do_state` /
  `do_position` / `do_view` by comparing against `LastUpdated*` cached values (`:106-125`).
- `cmd.reinitialize()` clears the stack: `WizardSet(G, nullptr, false)` at
  `packages/engine/layer3/Executive.cpp:16637`.
- Python API export list: `packages/engine/modules/pymol/api.py:283-290`.
- Only `refresh_wizard` and `replace_wizard` are registered as command-language keywords
  (`packages/engine/modules/pymol/keywords.py:223,228`) — `wizard` itself is auto-registered elsewhere;
  `cmd.wizard` is definitely reachable as a command (`demo.py:429` `self.cmd.do("_ wizard")`).

**There is no Python-visible "wizard changed" callback.** `WizardRefresh` is C pulling from
Python, so nothing on the Python side is notified. The bridge therefore wraps
`cmd.refresh_wizard` / `set_wizard` / `set_wizard_stack` / `dirty_wizard` and bumps a version
counter (`packages/bridge/tenmol_bridge/panels/wizards.py`, `install()` / `bump()`); the client
polls the cheap `wizards.probe` and only pulls `wizards.snapshot` when the version moved. That
is safe because *every* wizard calls `self.cmd.refresh_wizard()` after mutating state, and it
is necessary because `get_panel`/`get_prompt` have side effects (see §9.3 rules 4 and 5).

---

## 6. Where pick/select events come from

This is the single biggest architectural collision with a client-side WebGL viewport,
because **all pick/select dispatch currently happens in C++ during mouse handling.**

- Atom pick, `cButModePickAtom`: `packages/engine/layer1/SceneMouse.cpp:468` → `WizardDoPick(G, 0, state)`.
- Atom pick, editor path: `packages/engine/layer1/SceneMouse.cpp:427` → `WizardDoPick(G, 0, state)`.
- Bond pick / torsion: `packages/engine/layer1/SceneMouse.cpp:543` → `WizardDoPick(G, 1, state)`;
  `:545` is the non-bond fallback.
- Click-select (`cButModeSeleSet` etc.): `packages/engine/layer1/SceneMouse.cpp:135` and `:357` →
  `WizardDoSelect(G, selName, state)`.
- Rectangle/box select: `packages/engine/layer3/Executive.cpp:7563` → `WizardDoSelect(G, selName)`.
- Sequence-viewer select: `packages/engine/layer3/Seeker.cpp:150` and `:231` → `WizardDoSelect(G, selName)`.
- Keyboard: `packages/engine/layer5/PyMOL.cpp:2356` → `WizardDoKey`; `:2369` → `WizardDoSpecial`.
- Scene changed: `packages/engine/layer1/Scene.cpp:4812` → `WizardDoScene`.
- View/position: `packages/engine/layer1/Scene.cpp:4675-4676` → `WizardDoPosition` / `WizardDoView`.

`WizardDoPick` and `WizardDoSelect` both first call `do_pick_state(state+1)`
(`Wizard.cpp:189`, `:324`) — a **1-based state index of the picked object**, which only
`measurement.py:292` implements (to remember which state each of the 4 picks came from,
used at `measurement.py:317,332,355,381`).

Both also **PLog the exact Python replay line**:
`"cmd.get_wizard().do_pick(1)"` / `"cmd.get_wizard().do_pick(0)"` (`Wizard.cpp:319-321`) and
`"cmd.get_wizard().do_select('''%s''')"` (`Wizard.cpp:185`).
That log line is the replay contract the web path reproduces: the browser, after a
client-side ray pick, tells the bridge which atom was hit; the bridge does the equivalent of
the C editor work (`cmd.edit(...)` / `cmd.select("pk1", ...)`) then calls
`cmd.get_wizard().do_pick_state(state)` followed by `cmd.get_wizard().do_pick(bondFlag)`
(`packages/bridge/tenmol_bridge/panels/wizards.py::event`).

The C++ layer honours the event mask **before** calling Python
(`CWizard::isEventType`, `Wizard.cpp:140`); the bridge re-implements that gate, because
without it `do_pick` would reach wizards that never asked for picks (e.g. `annotation.py:7`
masks `scene|state|frame` only, `pseudoatom.py:17` masks `key` only, `command.py:149-152`
returns `0` unless in text-input mode).

---

## 7. Per-wizard catalogue

Launch names come from `_wizard()`'s `name.capitalize()` rule (`wizarding.py:41`), so
`wizard pair_fit` → class `Pair_fit`, `wizard nucmutagenesis` → `Nucmutagenesis`.

Menubar entries (`packages/engine/modules/pymol/_gui.py:834-864`): Appearance, Measurement,
Mutagenesis▸(Protein | Nucleic Acids), Pair Fitting, ─, Density, Filter, Sculpting, ─,
Label, Charge, ─, Demo▸(11 demos + End Demonstration).
Context-menu launches: `packages/engine/modules/pymol/menu.py:1163, 1194, 1234, 1268, 1298, 1314, 1401,
1437, 1454, 1845` (all `cmd.wizard("renaming", …)`) and `menu.py:1655`
(`cmd.wizard("pseudoatom","label",pos=[…])`).

---

### 7.1 `measurement.py` — Measurement (475 lines)

**Purpose:** interactive distance / angle / dihedral / H-bond / neighbor measurements.
Replaces the legacy `distance` wizard (`wizarding.py:88`).

**Panel** (`:195-203`), 6 rows:
1. `[1,'Measurement','']`
2. `[3, mode_name[mode], 'mode']`
3. `[3, object_mode_name[object_mode], 'object_mode']`
4. `[2,'Delete Last Object','cmd.get_wizard().delete_last()']`
5. `[2,'Delete All Measurements','cmd.get_wizard().delete_all()']`
6. `[2,'Done','cmd.set_wizard()']`

**Menu `mode`** (`:77-84`), built from `modes` (`:14-23`) with labels from `mode_name`
(`:24-33`): Distances(`pairs`), Distances to Rings(`rings`), Angles(`angle`),
Dihedrals(`dihed`), Polar Neighbors(`polar`), Heavy Neighbors(`heavy`),
Neighbors(`neigh`), Polar Contacts(`hbond`).
The three neighbor modes get a **submenu** built by `neighbor_submenu` (`:130-137`):
`in all objects`, `in object`▸(live object list, `neighbor_objects` `:108-117`, capped at 25),
`in selection`▸(live selection list, `neighbor_selections` `:119-128`, capped at 25),
`in other objects`, `in same object`. All call `set_neighbor_target(mode, target)` (`:163`).

**Menu `object_mode`** (`:89-94`): "Merge With Previous"(`merge`), "Replace Previous"(`overwr`),
"Create New Object"(`append`) (`:47-51`).

**State machine:** `self.status` 0→1→2→3 (`:65`), meaning "how many atoms picked".
`pairs`/`rings`/`hbond` need 2, `angle` needs 3, `dihed` needs 4 (`:319-426`).
`neigh|polar|heavy` are one-shot (`:427-469`). Prompt text is status-driven (`:242-264`)
and is worded using the current `mouse_selection_mode` ("first atom"/"first residue"/…,
`get_selection_name` `:223-240` maps 0..6 → atom/residue/chain/segment/object/molecule/C-alpha
plus the selection-expander prefix `br.`/`bc.`/`bs.`/`bo.`/`bm.`/`bca.`).

**Picking:** `do_pick` `:307` — first re-expands `pk1` by the mouse-selection-mode code
(`:310`), rejects bonds (`:311-313`), stores each pick as `_mw0`.._mw3`, mirrors into
`_indicate_mw` and enables it for visual feedback (`:322-323`).
`do_select` `:295` maps selections into picks by `cmd.select("pk1", name+" and not _mw*")`.
`do_pick_state` `:292` records per-pick state into `self.pick_state[status]`.

**Event mask:** `pick|select|dirty` (`:101-106`) — `dirty` only to notice
`mouse_selection_mode` changes and re-render the prompt (`do_dirty` `:472-475`).

**cmd calls:** `unpick`, `get_setting_float`(`neighbor_cutoff`, `heavy_neighbor_cutoff`,
`polar_neighbor_cutoff`, `h_bond_cutoff_center` — `:60-63`), `set("mouse_selection_mode",…)`
(`:97,184,212`), `deselect`, `get_names("public_objects"/"public_selections")`, `get_type`,
`select`, `delete`, `enable`, `dist(...,state1=,state2=)` (`:335`), `distance(mode=4)` for
rings (`:358`), `angle` (`:384`), `dihedral` (`:404`), `dist(mode=2,cutoff=hbond_cutoff)`
(`:422`), `get_selection_state('?pk1')` (`:332`), `refresh_wizard`.
Object naming: `measure%02d` via `get_name` (`:144-159`), counter persisted in
`self.session['meas_count']` (`:142`).

---

### 7.2 `mutagenesis.py` — Mutagenesis (protein) (730 lines)

**Purpose:** swap a residue for a rotamer library entry, with bump (strain) scoring.

**Refuses to run inside a movie:** raises `WizardError` if `get_movie_length() > 0` (`:47-48`),
which `wizarding.py:50-52` turns into a `Message` wizard.

**Panel** (`:276-295`), 10 rows:
`[1,'Mutagenesis','']`, `[3,'No Mutation'|'Mutate to X','mode']`,
`[3,'N-Cap: …','n_cap']`, `[3,'C-Cap: …','c_cap']`, `[3, hyd_name[hyd],'hyd']`,
`[3, rep_name[rep],'rep']`, `[3, dep_name[dep],'dep']`,
`[2,'Apply','cmd.get_wizard().apply()']`, `[2,'Clear','cmd.get_wizard().clear()']`,
`[2,'Done','cmd.set_wizard()']`.
Side effect inside `get_panel`: forces `mouse_selection_mode=1` (residue) every refresh (`:278-279`).

**Menus:**
- `mode` (`:93-135`) — "No change" + every residue in `sc_bb_ind.pkl` plus
  `GLY, ALA, HID, HIE, HIP, ARGN, LYSN, ASPH, GLUH` (`:74-84`); protonation variants are
  regrouped into nested submenus `ARG…`, `LYS…`, `HIS…`, `GLU…`, `ASP…` by the loop at
  `:113-133`. `NT_`/`CT_` variants are generated (`:81-84`) but **commented out of the
  menu** (`:102-107`) — they're still reachable via `set_mode`.
- `n_cap` (`:180-184`): Open / NH3+ / Acetyl (`:165-170`).
- `c_cap` (`:186-190`): Open / COO- / Amine / N-methyl (`:172-178`).
- `hyd` (`:192-196`): Hydrogens: Current / Add & Retain / Remove (`:157-163`).
- `rep` (`:198-202`): Show Lines / Sticks / Spheres / Dots (`:138-150`).
- `dep` (`:204-209`): Backbone Depen. Rotamers / Backbone Indep. Rotamers (`:152-155`).

**State machine:** `self.status` 0 = nothing picked, 1 = mutagenizing (`:61`).
If `pk1` already exists at launch it auto-enters status 1 (`:211-218`).

**Picking:** `do_pick` `:715` — rejects bonds, `select(_mute_sel,"(byres pk1)")`, enable,
`do_library()`. `do_select` `:695` — ignores clicks that land on the preview object
(`:698-701`), otherwise same path. `do_state(state)` `:678` — syncs the bump object,
prints `Rotamer n/N, strain=…` (`:684-686`), and rebuilds polar-contact distances
`_tmp_hbonds` (`:689-693`). Event mask `pick|select|state` (`:297-298`).

**`do_library()` (`:410-676`) is the heavy lifter** — the single most complex piece of
`cmd` orchestration in the whole wizard tree:
`feedback push/disable`, `iterate` to build the residue label, `select("_seeker_hilight")`,
`set('auto_zoom',0)`, `frame(0)`, `center(animate=-1)`, `fragment()`, `remove` hydrogens,
`alter` identity transfer via `self.space`, `pair_fit` of CA/CB/C/N (`:479-493`),
`iterate_state`/`alter_state` carbonyl + OXT + amide-H fixing (`:496-531`),
`editor.attach_amino_acid` for caps (`:539,541,557`), `h_fix`, `phi_psi` lookup into
the backbone-dependent library with 10°/20°/60° binning (`:578-589`), per-rotamer
`create` + `set_dihedral` + `set_title("%1.1f%%")` (`:599-616`), then bump checking with
`sculpt_activate` + `sculpt_iterate` per state (`:642-654`) and
`set("sculpt_vdw_vis_mode",1)` (`:645`).
Data files: `$PYMOL_DATA/chempy/sidechains/sc_bb_ind.pkl` (`:58`) and `sc_bb_dep.pkl`
(`:223-224`).

**`apply()` (`:326-399`):** two branches. Mutation branch (`:340-374`) does
`create/set_title/color/alter/select neighbor/remove/create merged/bond/set_geometry/h_fix`,
then `frame(1)`. Conformation-only branch (`:375-398`) uses `push_undo` + `update`.

**Objects/selections it owns:** `_mutate_sel`, `_bump_check`, `mutation`, `_tmp_mut`,
`_tmp_mut_sele`, `_tmp_obj2`, `_tmp_sele1`, `_tmp_sele2`, `_tmp_hbonds` (`:10-19`) —
plus `_seeker_hilight` (`:323`).

---

### 7.3 `nucmutagenesis.py` — Mutagenesis (nucleic acids) (426 lines)

Same shape, simpler. Also refuses movies (`:82-84`).

**Panel** (`:137-158`): `[1,'Mutagenesis','']`, `[3,'Mutate to X','mode']`,
`[3,'Auto Center: ON|OFF','auto_center']`, `[3, _rep_name[rep],'rep']`,
`[2,'Apply',…]`, `[2,'Clear',…]`, `[2,'Done','cmd.set_wizard()']`. Forces
`mouse_selection_mode=1` on every refresh (`:147-148`).

**Menus:** `mode` (`:99-104`) = Adenine/Cytosine/Guanine/Thymine/Uracil (`:72-78` → ATP/CTP/GTP/TTP/UTP);
`rep` (`:106-112`) = lines/sticks/spheres/dots (`:21-26`);
`auto_center` (`:114-117`) = ON / OFF.

**State machine:** `Status.NO_SELECTION=0` / `Status.MUTAGENIZING=1` (`:15-17`),
prompts at `:127-134`.

**Picking:** `do_pick` (`:160`) rejects bonds, then `do_select('byres pk1')` (`:170`).
`do_select` (`:173`) selects `_mutate_sel`, `unpick`, `_do_mutation()`, `delete`,
`refresh_wizard`, `deselect`. No `get_event_mask` override → default `pick|select`.

**Chemistry:** purine/pyrimidine chi-dihedral atom sets (`:33-36`), `_base_types` table
(`:38-54`), `_transfer_dihedral` uses `get_dihedral` + `set_dihedral` (`:221-235`),
`_update_reps` uses `show_as(rep+' lines', '?_tmp_mut')` (`:216-218`).
`apply()` (`:406-426`) builds an inverse selection of `_sugar_phos_atoms` (`:64-70`),
`remove`s the old base, `fuse`s the fragment, then `alter`s `resn` with a `D` prefix when
`O2'` is absent (DNA detection, `:420-421`).

---

### 7.4 `pair_fit.py` — Pair Fitting (190 lines)

**Purpose:** superpose two objects by user-picked atom pairs.

**Panel** (`:28-36`): `[1,'Pair Fitting','']`,
`[2,'Fit %d Pairs' % n_pair,'cmd.get_wizard().fit()']`,
`[2,'Delete Last Pair','…remove_last()']`, `[2,'Redraw','…update_dashes()']`,
`[2,'Clear','…clear()']`, `[2,'Done','cmd.set_wizard()']`. **No menus.**

**State machine:** `status` 0 = expecting mobile atom, 1 = expecting target atom (`:21`).
Prompts `'Pick the mobile atom...'` / `'Pick the target atom...'` (`:53-61`), plus an
appended `self.message` line carrying errors or the RMS result.

**Picking:** `do_pick` `:152`. Validates that each mobile atom is in the *same object* as
previous mobiles (`check_same_object` `:126`) and that the target is in a *different*
object (`check_different_object` `:134`). Selections are named `_pf_s_%02db` (mobile) and
`_pf_s_%02da` (target) — the trailing letter is how `get_sele_list(mode=)` (`:67-75`)
separates them. `do_select` `:142` maps a selection to a pick via `cmd.edit(...)`.

**cmd calls:** `pair_fit(*args)` (`:93`) after `push_undo` (`:92`); dashes drawn as
`dist(name,a,b,width=7,length=0.05,gap=0.05)` + `hide('label')` (`:121-122`);
`set/get_setting_int("mouse_selection_mode")` (`:24-25`, restored `:40`).

**Bug worth not cloning:** this module calls the *module-level* `cmd` rather than
`self.cmd` throughout (`:22-25`, `:40-51`, `:79-122`, `:143-190`), so it ignores `_self`.

---

### 7.5 `appearance.py` — Appearance (233 lines)

**Purpose:** click-to-restyle. A 3-dropdown "verb / object / scope" machine.

**Panel** (`:163-183`) is *dynamic*: always `[1,'Appearance Wizard','']` +
`[3, mode_dict[mode][0], 'mode']`; then **either** `[3, color_dict[color][0],'color']`
(modes 0,1) **or** `[3, what_dict[what][0],'what']` (modes 2,3,4) **or**
`[1,'Atoms','']` (mode 5); then `[3, scope_dict[scope][0],'scope']` and
`[2,'Done','cmd.set_wizard()']`. Good canonical test case for a **dynamic** React panel.

**Menus:**
- `mode` (`:74-83`): Color, Color (elem c), ─, Toggle, Show, Hide. (`mode_dict` `:15-22`
  also defines `5: Select` but its menu row is commented out at `:82`.)
- `what` (`:85-101`): Lines, Nonbonded, Sticks, Ribbon, Cartoon, ─, Labels, ─, Dots,
  Spheres, NB Spheres, ─, Mesh, Surface (`what_dict` `:24-36`).
- `color` (`:103-119`): 14 colors, each label carrying its own `\RGB` swatch code
  (`color_dict` `:38-53`): red, green, blue, yellow, magenta, cyan, salmon, lime, pink,
  slate, violet, orange, marine, hotpink.
- `scope` (`:121-130`): By Atom, By Residue, By Chain, By Segment, By Object, ─, By Molecule
  (`scope_dict` `:55-62`, mapping to selection operators `''`, `byres`, `bychain`,
  `bysegment`, `byobject`, `bymol`).

**Picking:** `do_pick` `:186` and `do_select` `:205` both synthesize a command string
`mode + '("what","(scope pk1)")'` and run it through `self.cmd.do(cmmd, log=0)` (`:192`).
The verbs are `_ cmd.color`, `_ util.color_carbon`, `_ cmd.toggle`, `_ cmd.show`,
`_ cmd.hide`, `_ cmd.select` (`:15-22`).

**Persistence:** module-level `saved_mode/scope/what/color` (`:7-10`), written back in
`cleanup()` (`:224-233`). `undo()` exists but only prints "no undo!" (`:156-157`) and its
panel row is commented out (`:180`).

---

### 7.6 `cleanup.py` — Cleanup / szybki (168 lines)

**Purpose:** run OpenEye `szybki` on a ligand and pull the minimized coords back.

**Hard dependency:** `auto_configure()` (`:13-34`) searches `$OE_DIR` / `$OEDIR` for
`bin/szybki[.exe]`; if not found `__init__` raises `pymol.CmdException` (`:52-54`), so the
wizard never opens.

**Panel** (`:126-137`): `[1,'Cleanup','']`, `[2,'Run','…run()']`, `[2,'Undo','…undo()']`,
`[2,'Redo','…redo()']`, `[3,"\\999Ligand:\\000 "+ligand,'ligand']`,
`[2,'Refresh','…update()']`, `[2,'Done','cmd.set_wizard()']`.
A `Target:` popup row exists but is commented out (`:134`).

**Menus:** `ligand` and `target` rebuilt by `update_menus()` (`:38-46`) from
`get_names("public_objects")`; `target` also gets a `(none)` entry (`:40`).

**Picking:** `do_pick` `:164` — if no ligand yet, adopt `get_object_list("pkmol")[0]`.
No `get_event_mask` override → `pick|select`. Enters `edit_mode()` on construction (`:65`).

**`run()` (`:88-116`):** `save('ligand_inp.mol')` → busy-wait for the file →
`cmd.system("szybki -i … -o …")` → busy-wait ≤1 s → `load('ligand_out.mol')` →
`alter(ID=index)` → `fit(matchmaker=2)` → `update(matchmaker=2)` → `delete` →
`sculpt_deactivate` → `sculpt_purge`. Undo/redo are implemented as object copies
`_w_cleanup_undo` / `_w_cleanup_redo` (`:10-11`, `:67-86`).

---

### 7.7 `density.py` — Density Map (256 lines)

**Purpose:** roving isomesh around a picked atom/residue, up to 3 maps.

**Panel** (`:159-176`), 14 rows: title, `Update Maps`, `Zoom`, `Next Res. (PgDown)`,
`Previous Res. (PgUp)`, `[3,"Radius: %3.1f A",'radius']`, then three
`Map N:`/`@ X sigma` popup pairs (`map0/level0`, `map1/level1`, `map2/level2`),
`[3, track label, 'track']`, `Done`. **Calls `update_map_menus()` inside `get_panel`
(`:160`)** — menus must be re-derived on every refresh.

**Menus:** `radius` (`:28-37`): 4/5/6/8/10/15/20/50 Å.
`level0..2` from the `level_menu` lambda (`:43-48`): 1.0/1.5/2.0/3.0/5.0/-3.0 sigma.
`map0..2` (`:79-87`): live list of `object:map` objects + `(none)`.
`track` (`:54-59`): Track & Zoom / Track & Center / Track & Set Origin / Track Off.

**Keybindings:** `set_key('pgup', … next_res(d=-1))` and `set_key('pgdn', … next_res())`
(`:68-69`), unbound in `cleanup()` (`:185-186`).

**Picking:** `do_pick` `:197` → `select("_dw","pk1")` + `update_maps()`; `do_select` `:191`
same from a named selection. Both are no-ops when `track == 2` (origin mode).
Event mask `pick|select|position` (`:205-206`); `do_position()` (`:208-210`) re-runs
`update_maps(zoom=0)` whenever the camera center moves and no `_dw` selection exists —
this is the actual "roving" behaviour.

**`update_maps()` (`:107-143`):** for each slot, `isomesh('w{n}_{map}', map, level, sele,
radius, state=1)`, coloring new meshes blue/white/magenta (`:126-131`), then
`zoom(animate=0.67)` / `center(animate=0.67)` / `origin()` per `track` (`:134-142`).

**`next_res(d=±1)` (`:212-256`, "Donated by Tom Lee"):** walks to the neighbouring residue's
CA / C1* / C1' atom, handles sequence gaps by enumerating the chain (`:236-248`), labels the
new residue `"  %s %s/%s/" % (resn,chain,resi)` (`:253`).

---

### 7.8 `filter.py` — Filter (402 lines)

**Purpose:** triage a multi-state (docked-compound) object into Accept/Reject/Defer.

**Panel** (`:228-254`), 12 rows: `[1,'Filtering Wizard','']`,
`[3, browse label, 'browse']`, `[3,'Object: %s','object']`,
`[2,'Accept (F1)',…]`, `[2,'Reject (F2)',…]`, `[2,'Defer (F3)',…]`,
`[2,'Forward (->)',…]`, `[2,'Back (<-)',…]`, `[3,'Create Filtered Object','create']`,
`[2,'Save %s.txt' % object,'…save()']`, `[2,'Refresh','cmd.refresh_wizard()']`,
`[2,'Done','cmd.set_wizard()']`. `update_object_menu()` is called from inside `get_panel`
(`:236`).

**Menus:** `browse` (`:82-89`): Browse All / Accepted / Rejected / Deferred / Remaining.
`create` (`:91-96`): Accepted / Rejected / Deferred.
`object` (`:138-141`): all `object:molecule` with `count_states>1`, plus `None`.

**Keybindings** (`:101-105`): F1=accept, F2=reject, F3=defer, →=forward, ←=backward;
restored in `cleanup()` (`:398-402`, note `left`/`right` are restored to `cmd.backward`/
`cmd.forward`, not to `None`).

**Prompt** (`:260-277`): two lines — `"obj: N accepted, N rejected, N deferred, N remaining"`
and `"<state>/<total> <title>: Accept|Reject|Defer"` (or `…?` when undecided).
Identifier format `'%d/%d %s' % (state, tota, get_title(...))` (`get_ident` `:256-258`).

**Picking:** `do_pick` `:115` → `do_select('pk1')`; `do_select` `:107` resolves the clicked
atom to its owning object and makes it the filter target. `do_state` `:119` just refreshes.
Event mask `pick|select|state` (`:122-123`).

**Browse filtering** (`set_browse` `:143-179`) drives the movie: `cmd.mset()` for all, or
`cmd.mset(' '.join(states))` + `cmd.rewind()` for a subset.
`create_object(what)` (`:339-347`) builds `<obj>_Accept` etc. via repeated `cmd.create`.
`save()` (`:349-389`) writes a TSV report next to the cwd, falling back to `~`.

**Persistence:** module-level `static_dict`, `default_object`, `default_browse`
(`:10-18`), saved in `cleanup()` (`:391-396`). `migrate_session` (`:28-58`) remaps
pre-1.7.0.0 title-keyed dicts to the new `state/total title` identifiers.

---

### 7.9 `label.py` — Labeling (101 lines)

**Purpose:** click an atom to toggle a formatted label on it.

**Panel** (`:70-77`): `[1,'Labeling','']`, `[3,'Mode: '+mode_names[mode],'mode']`,
`[2,'Messages: On|Off','cmd.get_wizard().toggle_messages()']`, `[2,'Done','cmd.set_wizard()']`.

**Menu `mode`** (`:36-43`) — 9 python-format templates (`mode_names` `:14-24`):
`{resn}-{resi}`, `{onelettercode}{resi}`, `{chain}/{resn}\`{resi}`,
`{chain}/{resn}\`{resi}/{name}\`{alt}`,
`/{model}/{segi}/{chain}/{resn}\`{resi}/{name}\`{alt}`, `{chain}`, `{resn}`, `{resi}`, `{name}`.

**Prompt** (`:52-64`): suppressed when `messages` is off; otherwise the full atom identifier
plus `B = …  XYZ = … … …`.

**Picking:** `do_pick` `:79` → `do_select('pk1')`; `do_select` `:83` uses
`iterate_state(-1, 'first ?sele', 'self.atom = (model,segi,chain,resn,resi,name,alt,b,x,y,z,label)')`
(`:85-87`, field list at `:26-28`), and **toggles**: if the atom already has a label it sets
`''`, otherwise it formats the template (one-letter code via
`pymol.exporting._resn_to_aa`, `:6`, `:96`). Forces `mouse_selection_mode=0` at construction
(`:34`). Event mask `pick|select` (`:45-46`).

---

### 7.10 `charge.py` — Charge (296 lines)

**Purpose:** inspect / move / zero `partial_charge` on atoms and residues.

**Panel** (`:53-59`): `[1,'Charge Wizard','']`, `[3, mode_name[mode],'mode']`,
`[2,'Clear','cmd.get_wizard().clear()']`, `[2,'Done','cmd.set_wizard()']`.

**Menu `mode`** (`:41-46`), 9 entries (`modes` `:12-22`, labels `:27-37`):
Show(`labchg`), Add(`addchg`), Copy(`cpychg`), Zero(`zrochg`), Move & Zero (atom)(`mzochg`),
Move & Zero (resi)(`cbachg`), Move & Remove (atom)(`movchg`), Move & Remove (resi)(`rbachg`),
Get Total Charge(`sumchg`).

**State machine:** `status` 0 = pick source, 1 = pick destination (`:30`). Each mode has its
own two prompt strings (`:79-122`), several of which interpolate `self.partial_charge`.
`get_prompt` also side-computes and *prepends* "Total charge on the residue is …" by
`iterate("(byres wcharge)")` whenever the `wcharge` selection exists (`:124-128`) — i.e.
**`get_prompt` has side effects and issues `cmd` calls; the bridge must not call it
speculatively.**

**Picking:** `do_pick` `:142` — a long per-mode dispatch (`:146-294`) using
`iterate`/`alter`/`label`/`remove`/`select("wcharge",…)`/`enable`. Residue modes build a
`name -> charge` dict and transfer only atoms present in both residues (`:167-206`).
`sumchg` sums over `(pkmol)` (`:287-294`). Enters `edit_mode()` at construction (`:50`).
No `get_event_mask` override → `pick|select`, though `do_select` is not implemented.

**Persistence:** module-level `default_mode` (`:5`, saved `:61-64`).

---

### 7.11 `sculpting.py` — Sculpting (227 lines)

**Purpose:** pick a center atom, auto-partition the object into free / fixed / excluded
shells, and turn on the real-time sculpting engine.

**Panel** (`:169-180`): `[1,'Sculpting','']`, `[3, mode_name[mode],'mode']`,
`[3,'Radius: %3.1f A','radius']`, `[3,'Cushion: %3.1f A','cushion']`,
`[2,'Toggle Sculpting','cmd.set("sculpting",{"off":"on"}.get(cmd.get("sculpting"),0))']`,
`[2,'Toggle Bumps','cmd.set("sculpt_vdw_vis_mode",{0:1}.get(int(cmd.get("sculpt_vdw_vis_mode")),0))']`,
`[2,'Relocate','cmd.get_wizard().free_all()']`, `[2,'Done','cmd.set_wizard()']`.
Note the two Toggle rows carry **raw inline Python**, not a `get_wizard()` call —
proof the panel `code` is a general command string.

**Menus:** `mode` (`:83-87`) — only `One Residue`(`ligand_rx`) and `Residue Shells`(`by_resi`)
are listed (`modes` `:67-72`); `by_atom` / `ligand_re` are defined in `mode_name` (`:74-81`)
but commented out. `radius` (`:89-97`): 4/5/6/8/10/15/20 Å.
`cushion` (`:99-107`): 2/3/4/6/8/10/12 Å.

**Constructor side effects (`:39-62`):** forces `edit_mode(1)` if not already editing
(remembering how to restore, `:41-45`), saves and sets `sculpt_vdw_vis_mode`,
`sculpt_deactivate("all")`, `set("sculpting")`, `unmask("all")`.

**State machine:** `NO_SELECTIONS=0` / `HAVE_SELECTIONS=1` (`:22-23`).
Prompt only exists in state 0: `'Please pick the center atom...'` (`:207-213`).

**Picking:** `do_pick` `:215` — only accepts the *first* pick; returns 0 afterwards so the
pick falls through to normal editing. Also `push_undo` per object (`:221-222`).

**`update_selections()` (`:126-161`)** is the core: builds `sclpt_wz_free`, `sclpt_wz_fix`,
`sclpt_wz_excl` selections from `sclpt_wz_cent` using the `x;` (within) operator, then
`protect`/`deprotect`, `flag('exclude', …)`, `color('grey')`, `mask`/`unmask`,
`zoom(animate=1)`, `util.cbac`/`util.cbag`, disables the helper selections, and
`sculpt_activate(obj)` after `push_undo(obj)`.

**`cleanup()` (`:196-205`)** restores edit mode, `sculpt_vdw_vis_mode`, `sculpting=0`,
then `clear()` which unmasks/deprotects/deactivates everything and deletes `sclpt_wz_*`.

Dead code: `set_object_mode` (`:163-167`) references `self.object_modes`, which is never
defined — calling it raises `AttributeError`. Not reachable from the panel.

---

### 7.12 `message.py` — Message (36 lines)

**Purpose:** the generic modal notice. Used by the error path in `wizarding.py:50-52` and by
`pymol/__init__.py:271`.

**Constructor:** `Message(*arg, dismiss=1, _self=cmd)` (`:11`); positional args are flattened
into a list of lines (`:14-18`) and echoed to the console with `\RGB` codes stripped
(`:19-20`) using `_nuke_color_re` (`:7`).

**Panel** (`:27-36`): with `dismiss=1` → `[1,'Message','']`, `[2,'Dismiss','cmd.set_wizard()']`;
with `dismiss=0` → **`[]` (empty panel, prompt-only overlay)**. The `hasattr` guard at `:28`
exists for un-pickling older sessions.
Invoked from the command line as `wizard message, <text>, dismiss=0`
(see `stereodemo.py:18` for a live example).

---

### 7.13 `demo.py` — Demo (456 lines)

**Purpose:** the built-in feature tour.

**Panel** (`:39-54`), 13 rows, every one of them `replace_wizard demo,<name>`:
Representations(`reps`), Cartoon Ribbons(`cartoon`), Roving Detail(`roving`),
Roving Density(`roving_density`), Transparency(`trans`), Ray Tracing(`ray`),
Sculpting(`sculpt`), Scripted Animation(`anime`), Electrostatics(`elec`), CGOs(`cgo`),
Molscript/R3D Input(`raster3d`), End Demonstration(`finish`).
No menus. Prompt = `self.message` (`:34-37`).

**Behaviour:** `__init__(name=None)` (`:12-32`) — on a named launch it first calls
`<last>(cleanup=1)` to tear down the previous demo (`:20-22`), then runs the new demo body
**on a daemon thread** (`:26-28`), and pulls a hint string out of
`DemoInfo.message_dict` (`:67-76`; keys `roving`, `roving_density`, `elec`, `sculpt` —
these are the mouse-instruction overlays). Last demo name persists in module-level
`saved` (`:4`, `:32`).

**`DemoInfo` (`:62`)** bodies each take `cleanup=0|1` and are pure `cmd` scripts:
`reps` (`:100`), `raster3d` (`:174`), `cgo` (`:190`), `anime` (`:228`), `roving` (`:277`),
`roving_density` (`:308`), `cartoon` (`:352`), `elec` (`:371`), `trans` (`:391`),
`ray` (`:410`), `finish` (`:428` → `cmd.do("_ wizard")`), `sculpt` (`:431`).
Deprecated bodies `rep_old` (`:78`) and `anime_old` (`:204`) are unreferenced.
Assets: `$PYMOL_DATA/demo/{pept.pdb, pept.pkl, il2.pdb, 1tii.pdb, 1hpv.r3d, cgo03.py}` and
`$TUT/1hpv.pdb`.

---

### 7.14 `stereodemo.py` — Stereodemo (441 lines)

**Purpose:** the "kiosk" demo used for stereo hardware, launched as
`wizard stereodemo[,name[,mono]]`.

**Panel** (`:46-72`), 16 rows including **five `[1,…]` section headers** —
"Structural Biology", "Drug Discovery", "Presentation Graphics", "Bioinformatics",
"Science Education", "Configuration" — with buttons:
X-ray Crystallography(`roving_density`), Electron Tomography(`electomo`),
Medicinal Chemistry(`medchem`), Computational Chemistry(`electro`),
Molecular Animation(`animate`), Multiprocessor Raytracing(`ray`),
Structure Alignments(`structure`), Homology Modeling(`homology`),
Interactive Modeling(`sculpt`), Toggle Fullscreen(`cmd.full_screen()`),
Toggle Stereo 3D(`cmd.stereo("off" if cmd.get_setting_int("stereo") else "on")`).
This is the best example of a **grouped/sectioned** panel for the React renderer.

**Constructor** (`:30-38`): `cmd.full_screen("off")`, `cmd.stereo("on")` unless `mono`,
then `launch(name)` (default `"cartoon"`).
`launch()` (`:10-27`) tears down the previous demo, `cmd.delete("all")`, pushes a
`wizard message, Please wait while the %s example loads..., dismiss=0` notice (`:18`), then
runs the demo on a daemon thread (`:22-24`). Demo bodies at `:101-441` load `.pse` sessions
via `get_sess` (`:93-99`).

---

### 7.15 `benchmark.py` — Benchmark (368 lines)

**Panel** (`:349-367`), 17 rows: Run All / Run GL / Run CPU / Updates / Smooth Lines /
Jagged Lines / Dots / Sticks / Surface / Spheres / Cartoon / Blits /
Surface Calculation / Mesh Calculation / Ray Tracing / End Demonstration.
All buttons call `cmd.get_wizard().delay_launch("<name>")` (`:340-347`), which does
`reinitialize()` (`configure` `:22-23`), `viewport(640,480)`, disables all feedback except
python output, and runs on a daemon thread (`:346-348`). Results go to stdout via
`report()` (`:15-17`). No menus; prompt = `self.message` (`:336-338`).

---

### 7.16 `box.py` — Box (445 lines)

**Purpose:** draw an editable CGO box/plane/quad from four draggable pseudo-atoms.

**Panel** (`:384-395`): `[1,'Box Wizard','']`, `[3, mode_name[mode],'mode']`,
`[2,'Change Name','cmd.get_wizard().edit_name()']`,
`[2,'Copy Box','cmd.get_wizard().edit_name(copying=1)']`,
`[2,'Toggle Points','cmd.get_wizard().toggle_points()']`,
`[2,'Auto-Position (50%)','…auto_position(0.75)']`,
`[2,'Auto-Position (99%)','…auto_position(0.99)']`, `[2,'Done','cmd.set_wizard()']`.
(An `Update` row is commented out at `:392`.)

**Menu `mode`** (`:56-60`): Box / Walls / Plane / Quad (`:41-53`).

**Text-entry sub-state:** `edit_name()` (`:85-89`) sets `self.editing_name = 1`, which
(a) flips `get_event_mask` to include `event_mask_key` (`:398-403`) and
(b) changes `get_prompt` to `"Enter box name: " + new_name` (`:440-445`).
`do_key` (`:423-437`) implements a hand-rolled line editor: backspace (8/127),
printable (`k>32`), Enter (10/13) commits and defaults to `"box"` when blank.
**This inline text-input pattern is shared with `renaming.py`, `pseudoatom.py` and
`command.py` — implement it once in React as a `<WizardTextInput/>`.**

**Live view coupling:** event mask always includes `event_mask_scene` (`:398-403`);
`do_scene()` (`:405-418`) diffs the four pseudo-atom coordinates and rebuilds the CGO when
they move. `auto_position(fract,size)` (`:91-…`) computes box placement from
`get_setting_float("field_of_view")` and `get_view()`. `do_pick` is an explicit no-op (`:420-421`).

Geometry built with `chempy.models.Indexed` + `pymol.cgo` (`:7-11`), pseudo-atom template at
`:14-18`.

---

### 7.17 `command.py` — Command (178 lines)

**Purpose:** a **generic wizard that introspects any PyMOL command** and renders one popup
row per keyword argument. Docstring: "Generic wizard for any PyMOL command." (`:6-8`).
This is the closest existing thing to the generic contract we want in React.

**Panel** (`:119-141`) — three shapes:
- no command chosen → `[3,'Select a command...','_commands']`, `[2,'Done','cmd.set_wizard()']`.
- text-input active → `[1,'Input','']`, `[2,'Apply', …apply_input()]`, `[2,'Cancel ', …set_input_arg()]`.
- normal → `[1,'<Command> Wizard','']` + one `[3,'<arg>: <value>', '<arg>']` row per
  parameter + `[2,'Run', …run()]` + `[2,'Done','cmd.set_wizard()']`.

**Menus:** built per-argument in `set_command` (`:60-64`) as
`[title, separator, 'Enter value...']`; `get_menu` is **overridden** (`:87-104`) and
- for the magic tag `'_commands'` returns the full keyword list from
  `pymol.keywords.get_command_keywords()` (`:88-95`);
- otherwise splices live auto-completion values from `self.cmd.auto_arg` into the menu
  (`:100-103`, `set_menu_values` `:81-85`, top 20 keywords).

**Introspection:** `inspect.signature(self.func)` (`:44`), stops at the first non
`POSITIONAL_OR_KEYWORD` parameter (`:53-54`), skips `_`-prefixed and `quiet` (`:57`,
`ignored_args` `:11`). Defaults captured at `:70-76`.

**Text input:** `set_input_arg` (`:154-160`), `apply_input` (`:162-164`),
`do_key` (`:166-178`) with a numeric-only mode (`:173`). Event mask is `key` only while
inputting, else `0` (`:149-152`).

**Reference cycle handling:** stores itself on `pymol.stored` under a generated name
(`:30-32`) so panel commands can be `stored._wizardN.run()` (`:33`, `:135-139`); removed in
`cleanup` (`:116-117`). `__getstate__` blanks `shortcut` (`:13-16`) because the shortcut
objects aren't picklable. Runs commands through `cmd.async_` when `async_` is set (`:111-112`).

---

### 7.18 `distance.py` — Distance (193 lines) — LEGACY

Superseded by `measurement.py`; `cmd.wizard("distance")` is rewritten to `measurement`
(`wizarding.py:88-89`), so this module is reachable only as `cmd.wizard("Distance")`… no —
it is effectively unreachable via `cmd.wizard`. Kept for API/session compatibility.

**Panel** (`:89-97`): `[1,'Distance Measurement','']`, `[3, mode_name,'mode']`,
`[3, object_mode_name,'object_mode']`, `Delete Last`, `Delete All`, `Done`.
**Menus:** `mode` (`:46-50`) Polar/Heavy/Neighbors/Pairwise Distances;
`object_mode` (`:64-68`) Replace Previous / Create New.
`do_pick` `:148`, `do_select` `:142`. Objects named `dist%02d`, module-global `dist_count`
(`:14`). Also calls module-level `cmd` rather than `self.cmd` throughout.

---

### 7.19 `dragging.py` — Dragging (106 lines)

**Purpose:** the panel that appears while the mouse is in "drag" editor scheme.

**Panel** (`:82-106`) — two shapes:
- dragging atoms: `[1,'Dragging %d atoms in','']`, `[1,'object "<obj>"','']`,
  `[2,'Undo (CTRL-Z)','cmd.undo()']`, `[2,'Redo (CTRL-A)','cmd.redo()']`,
  `[2,'Indicate','cmd.get_wizard().indicate()']`, `[2,'Done','cmd.set_wizard()']`.
- dragging an object matrix: `[1,'Dragging matrix for','']`, `[1,'object "<obj>"','']`,
  `[2,'Reset','cmd.reset(object="<obj>")']`, `[2,'Done','cmd.set_wizard()']`.
- **`get_panel()` can return `None`** (`:104-105`) when the wizard has gone invalid — the
  React renderer must tolerate `None`/`[]`.

**Self-dismiss:** `check_valid()` (`:46-56`) polls `cmd.get_editor_scheme() != 3` and does
`self.cmd.do("_ cmd.set_wizard()")` — i.e. **a wizard can dismiss itself from an event
handler**. Event mask `pick|dirty` (`:58-59`); `do_dirty` (`:42-44`) is what drives the check.
`cleanup()` (`:72-80`) calls `cmd.drag()`, disables `_drag`, restores `button_mode`
and `cmd.mouse()`.
Latent bug: `self.old_button_mode` is only assigned when constructed with an argument
(`:21-22`), so `cleanup` at `:78` can raise `AttributeError`.

---

### 7.20 `openvr.py` — Openvr (97 lines)

**Purpose:** the in-headset VR menu. Launched automatically by the core when stereo mode
switches to OpenVR: `PParse(G, "cmd.set_wizard_stack()")` then `PParse(G, "wizard openvr")`
at `packages/engine/layer1/Scene.cpp:1126-1128`.

**Purely declarative — assigns `self.panel` directly** (`:92-97`), relying on the base
`get_panel` (`wizard/__init__.py:52`):
`[1,'OpenVR Menu','']`, `[3,'Scene','scene']`, `[3,'Wizard','wizard']`, `[3,'VR GUI','gui']`.

**Menus:**
- `scene` (`:9-30`): Next / Previous / ─ / Append / Store…▸(F1..F12) — a **nested list submenu**.
- `wizard` (`:31-36`): Measurement / Mutagenesis / Density — i.e. **a wizard that launches
  other wizards** (stack push).
- `gui` (`:37-91`): 7 presets (Old Defaults, Spatial Opaque, Spatial Semi-Transparent,
  Spatial Transparent, Overlay, Responsive Overlay, Responsive Spatial), each a
  semicolon-joined `set openvr_gui_*` command string.

---

### 7.21 `annotation.py` — Annotation (102 lines)

**Purpose:** show per-state SD-file annotations as a prompt overlay.

**Panel** (`:31-35`): `[1,'Annotation','']`, `[2,'Dismiss','cmd.set_wizard()']`.
**No picking at all** — event mask is `scene|state|frame` (`:7-8`); each of
`do_scene`/`do_frame`/`do_state` (`:10-17`) just calls `self.cmd.dirty_wizard()`, forcing a
refresh on the next update pass.
`get_prompt` (`:19-29`) reads `pymol.session.annotation[obj][state]` for every **enabled**
object (`get_names('objects',1)`).
Companion loader `load_annotated_sdf(filename, object, state, discrete)` (`:42-102`) parses
an SD file with `chempy.sdf.SDF`, `read_molstr`s each record, and stores colored annotation
lines (`\955`, `\595`, `\559` — `:86-93`).

---

### 7.22 `pseudoatom.py` — Pseudoatom (45 lines)

**Purpose:** inline text entry to create a labeled pseudoatom at a 3D position. Launched
from the viewport context menu: `menu.py:1655`
`cmd.wizard("pseudoatom","label",pos=[x,y,z])`.

**Panel** (`:42-45`): a single `[2,'Cancel','cmd.set_wizard()']` row — **no title row**.
**Prompt** (`:38-40`): `r'Label text: \888' + text + "_"` (fake caret).
**Event mask: `key` only** (`:17-18`). `do_key` (`:20-36`): 8/127 backspace,
27 escape→`set_wizard()`, 32 space, `>32` append, 10/13 commit →
`get_unused_name(text[:14].lower(), 0)` + `cmd.pseudoatom(obj, pos=…, label=…)` +
`set_wizard()`.

---

### 7.23 `renaming.py` — Renaming (49 lines)

**Purpose:** inline rename of an object / selection / group / scene. Launched from 10 places
in `packages/engine/modules/pymol/menu.py` (see §7 header list).

**Constructor** `Renaming(old_name, mode='object')` (`:9`).
**Panel** (`:45-49`): `[1,'Renaming','']`, `[2,'Cancel','cmd.set_wizard()']`.
**Prompt** (`:41-43`): `'Renaming \\999<old>\\--- to: \\999' + new_name + "_"`.
**Event mask: `key` only** (`:17-18`). `do_key` (`:20-39`): space becomes `_` (`:26-27`);
Enter runs `set_name <old>,<new>` for `mode='object'` (`:31-33`) or
`scene <old>,rename,new_key=<new>` for `mode='scene'` (`:34-36`).
Uses module-level `cmd`, not `self.cmd` (`:24-38`).

---

### 7.24 `security.py` — Security (45 lines)

**Purpose:** the "this session file contains movie commands" consent gate.

**Prompt** (`:15-34`): a 17-line fixed warning block, also echoed to the console at
construction (`:12-13`).
**Panel** (`:37-45`): `[1,'Assume Movie Risks?','']`, `[2,'accept','cmd.accept()']`,
`[1,'','']` (spacer), `[2,'decline','cmd.decline()']`, `[1,'','']`,
`[2,'mdump','cmd.mdump()']`. Note the empty `[1,'','']` **spacer rows** — the React renderer
must reserve vertical space for them.

---

### 7.25 `toggle.py` — Toggle (42 lines)

**Purpose:** kiosk-style toggles plus an optional message overlay.

**Panel** (`:30-42`): `[2,'Toggle Fullscreen','cmd.full_screen()']`,
`[2,'Toggle Stereo 3D','cmd.stereo("off" if cmd.get_setting_int("stereo") else "on")']`,
`[2,'Toggle Message','cmd.get_wizard().toggle()']`, `[2,'Dismiss','cmd.set_wizard()']`.
**The panel is edited in place**: when there is no message, row index 2 is deleted (`:40-41`).
Prompt is `self.message` or `None` (`:23-28`).

**Bug worth noting:** `__init__` (`:8-17`) **never calls `Wizard.__init__`**, so `self.cmd`,
`self.menu`, `self.panel` and `self.session` do not exist; it falls back to the module-level
`cmd` at `:21`. A generic bridge must not assume `wiz.cmd` exists.

---

## 8. Related wizards outside `packages/engine/modules/pymol/wizard/`

`packages/engine/modules/pmg_qt/builder.py` defines **19 more `Wizard` subclasses** that use the
identical panel/prompt/do_pick contract, driven by the Builder GUI:
`ActionWizard` (`:39`), `CleanWizard` (`:89`), `SculptWizard` (`:134`),
`RepeatableActionWizard` (`:228`), `ReplaceWizard` (`:266`), `AttachWizard` (`:302`),
`BioPolymerWizard` (`:368`), `AminoAcidWizard` (`:473`), `NucleicAcidWizard` (`:494`),
`ValenceWizard` (`:514`), `ChargeWizard` (`:566`), `InvertWizard` (`:607`),
`BondWizard` (`:646`), `UnbondWizard` (`:700`), `HydrogenWizard` (`:743`),
`RemoveWizard` (`:808`), `AtomFlagWizard` (`:844`), `FixAtomWizard` (`:982`),
`RestAtomWizard` (`:986`). They call `self.cmd.set_wizard(self, replace=1)` (`:56`, `:254`)
to swap themselves onto the stack, so they render through the same generic renderer with no
builder-specific code. See `docs/builder.md` for the surface that drives them and
`apps/web/src/features/builder/` for the port.

---

## 9. The generic contract, as ported

### 9.1 Bridge RPCs

Served by `packages/bridge/tenmol_bridge/panels/wizards.py`, granted by
`packages/bridge/tenmol_bridge/policy/grants/wp-16.py`, typed in
`packages/protocol/src/topics/wizard.ts` (`WIZARD_RPC`), called from
`apps/web/src/features/wizards/service.ts`. Each is a thin wrapper over a confirmed API:

```
wizards.launch(name, args, kwargs)   -> cmd.wizard(name, *args, **kwargs)   wizarding.py:62
wizards.replace(name, args, kwargs)  -> cmd.replace_wizard(...)             wizarding.py:94
wizards.dismiss()                    -> cmd.set_wizard()                    wizarding.py:110
                                        (None pops the top and runs cleanup)

wizards.probe()    -> cheap {version, depth}; version bumps from the wrapped
                      refresh_wizard / set_wizard / set_wizard_stack / dirty_wizard
wizards.snapshot() -> {
    depth,        # len(cmd.get_wizard_stack())          wizarding.py:166
    cls, module,  # top.__class__.__name__ / __module__
    panel,        # top.get_panel()      (may be None or [])
    prompt,       # top.get_prompt()     (may be None)
    eventMask,    # top.get_event_mask()
}

wizards.menu(tag) -> MenuItem[] | null
    # cmd.get_wizard().get_menu(tag), then callables resolved recursively,
    # mirroring packages/engine/layer4/PopUp.cpp:88-105
    # MenuItem = { code: 0|1|2, text, command?, submenu? }

wizards.exec_code(code)
    # server-side PParse equivalent.  packages/engine/layer1/Wizard.cpp:573-576
    # `code` is NEVER evaluated in the browser.

wizards.event(kind, payload)
    # kind in: pick | select | key | special | scene | state | frame | dirty | view | position
    # gated on (eventMask & bit) exactly like CWizard::isEventType
    #                          packages/engine/layer1/Wizard.cpp:140-143, 177, 311, 331, ...
wizards.catalog()  -> the Wizard menubar tree (_gui.py:834-864) as JSON
```

There is no server→client push topic for wizards; the client polls `wizards.probe` and only
pulls `wizards.snapshot` when the version moved. That is forced by §9.3 rules 4 and 5:
`get_panel()` and `get_prompt()` have side effects, so they cannot be called speculatively.

### 9.2 Components (`apps/web/src/features/wizards/`)

- `WizardPanel.tsx` — renders `snapshot.panel`. One row per type: `0` spacer, `1` label,
  `2` button (press state on pointerdown, `wizards.exec_code(code)` on pointerup-inside),
  `3` popup button (opens `WizardPopupMenu` fed by `wizards.menu(code)` — **fetched on open,
  never cached**, because `density.py:160`, `filter.py:236`, `command.py:87` rebuild menus
  live). Row height mirrors `internal_gui_control_size` (`packages/engine/layer1/Wizard.cpp:255`).
- `WizardPrompt.tsx` — top-left viewport overlay, honours `wizard_prompt_mode` 0/1/2/3
  (`packages/engine/layer1/Ortho.cpp:2136-2190`), default text color `rgb(51,255,51)` and backdrop
  `rgb(51,51,51)` (`packages/engine/layer1/Ortho.cpp:2692-2697`).
- `WizardPopupMenu.tsx` — codes 0/1/2 → separator / item / title
  (`packages/engine/layer4/PopUp.cpp:293-320`); nested `submenu` opens on hover; leaf runs
  `wizards.exec_code(command)`.
- `ColorCodedText.tsx` + `colorCodes.ts` — the `\RGB` / `\---` parser
  (`packages/engine/layer1/Text.cpp:507-548`).
- `WizardsPanel.tsx` — the stack; `snapshot.depth > 1` means nested wizards
  (`packages/engine/layer1/Wizard.cpp:280-282`).
- `WizardKeyCapture.tsx` — synthesizes `do_key(k,x,y,mod)` from real keystrokes for the four
  wizards that implement a hand-rolled line editor (`box.py:423`, `renaming.py:20`,
  `pseudoatom.py:20`, `command.py:166`). ASCII codes are what they compare against:
  8/127 backspace, 10/13 enter, 27 escape, 32 space, `>32` printable.
- `WizardLauncher.tsx` — the Wizard menubar (`_gui.py:834-864`) fed by `wizards.catalog`.

### 9.3 Rules the renderer obeys (each derived from real source)

1. **Panel may be `None` or `[]`.** `dragging.py:104-105` returns `None`;
   `message.py:36` returns `[]`. C treats both as height 0 (`Wizard.cpp:254-259`).
2. **Panel rows must have ≥3 elements**; extras are ignored (`Wizard.cpp:241`).
3. **Text is truncated**: `WordType` for panel text, `OrthoLineType` for code
   (`Wizard.cpp:243-246`). Web can render full text; just don't rely on truncation.
4. **`get_panel()` has side effects.** `mutagenesis.py:278`, `nucmutagenesis.py:147` change
   `mouse_selection_mode`; `density.py:160` and `filter.py:236` rebuild menus. Call it
   exactly once per refresh, never speculatively.
5. **`get_prompt()` has side effects too** — `charge.py:124-128` runs `cmd.iterate`.
6. **Buttons fire on release, popups on press** (`Wizard.cpp:481-511` vs `:552-583`).
7. **Menus are dynamic** — always re-fetch on open.
8. **Menu third element may be a callable** — resolve server-side (`PopUp.cpp:88-105`).
9. **Gate events on the mask** before dispatching; refresh the mask on every snapshot
   because it changes with wizard sub-state (`box.py:398-403`, `command.py:149-152`).
10. **`do_pick_state(state)` fires before `do_pick`/`do_select`, with `state+1`**
    (`Wizard.cpp:189`, `:324`).
11. **All wizard methods are optional** — probe with `hasattr` semantics
    (`Wizard.cpp:162`), never assume presence.
12. **Wizards can dismiss themselves** from a handler (`dragging.py:52`) and can
    **push other wizards** (`openvr.py:31-36`, `demo.py:42-53`) — the client reconciles
    from the pushed snapshot, not from optimistic local state.

---

## 10. Wizards that stay out of reach

Three bundled wizards cannot run in this deployment, for reasons in their own source rather
than in the port:

- `cleanup.py` — `__init__` raises `pymol.CmdException` unless an OpenEye `szybki` binary is
  found under `$OE_DIR`/`$OEDIR` (`:13-34`, `:52-54`), so the wizard never opens.
- `openvr.py` — launched only by the core when stereo mode switches to OpenVR
  (`packages/engine/layer1/Scene.cpp:1126-1128`); there is no OpenVR stereo path here.
- `benchmark.py` — measures GL blit and raytrace throughput of the local GL window
  (`:349-367`); the numbers describe the bridge's offscreen context, not the browser.

`distance.py` is dead by upstream's own rewrite: `cmd.wizard("distance")` is rewritten to
`measurement` (`wizarding.py:88-89`). It is kept for session compatibility only.
