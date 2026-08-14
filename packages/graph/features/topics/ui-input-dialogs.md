---
name: ui-input-dialogs
kind: feature
category: ui-gui
subcategory: input and dialog windows
summary: PyMOL's input surface — mouse-button/modifier binding tables, the mouse-mode rings, the keyboard shortcut map, and the seven modeless dialog windows (volume, properties, scenes, shortcuts, advanced settings, text editor, builder).
parity: implemented
---

# UI: input bindings and dialog windows

Everything the user *drives* PyMOL with: the `button`/`mouse`/`config_mouse` binding
system, the per-mode button×modifier matrices, the keyboard shortcut table exposed
through `set_key`, and the modeless dialog windows. Signatures and defaults below are
copied verbatim from `docs/api-reference/commands.mdx`; behaviour is anchored to
`packages/engine/` (unmodified upstream) and the area docs
`docs/input-mouse-keyboard.md`, `docs/dialogs-volume-properties-scenes.md`,
`docs/builder.md`.

The port lives in `packages/viewport/src/input/` (mouse/keys/butmode mirror) and
`apps/web/src/features/` (`mouse/`, `keyboard/`, `shortcuts/`, `volume/`,
`properties/`, `scenes/`, `dialogs/`, `texteditor/`, `builder/`).

---

## button

### Purpose
Redefine what a single mouse button + modifier does in the current mouse mode. It is
the only supported *write* path into the 80-slot `ButMode` table; there is no Python
getter (`ButModeGet` exists in C but is not exposed), so the client mirrors the
Python `mode_dict` instead of reading back.

### Syntax
`button(button, modifier, action)`

| Param | Type | Default | Meaning |
|---|---|---|---|
| `button` | string | — | `l`/`m`/`r`, `wheel`, `double_left`…`single_right` (abbreviation-matched) |
| `modifier` | string | — | `none`, `shft`, `ctrl`, `ctsh`, `alt`, `alsh`, `ctal`, `ctas` |
| `action` | string | — | an action name (`Rota`, `Move`, `+Box`, `PkAt`, `Menu`, …) |

### Behaviour
Names are resolved through the `Shortcut` prefix-matcher, so `button('l','shft','+Box')`
works. The three arguments are bit-packed into a slot index (L/M/R → `b+3*m` or
`b+68+3*(m-4)`; wheel → `12+m` or `64+m-4`; single/double → `(16+n-4)+m*6`) and written
via `_cmd.button`. Changing a slot does not touch the mode name; `cmd.mouse()` rewrites
whole rows.

### Examples
```python
button("r", "shft", "clip")      # right+Shift → clip near/far
button("wheel", "none", "slab")  # wheel scales the slab
```

### Related
[mouse](#mouse) · [config_mouse](#config_mouse) · [set_key](#set_key)

### Source
`packages/engine/modules/pymol/controlling.py:799-868`; commands.mdx `cmd.button`.
Port mirror: `packages/viewport/src/input/butmode.ts`.

---

## mouse

### Purpose
Cycle through — or jump directly to — the mouse modes of the current configuration
ring, or step the selection level. This is the runtime mode switcher wired to the
in-viewport ButMode block.

### Syntax
`mouse(action=None, quiet=1)`

| Param | Type | Default | Meaning |
|---|---|---|---|
| `action` | string | `None` | `forward`/`backward` (step mode), `select_forward`/`select_backward` (step selection level 0..6), or a bare mode name to jump directly |
| `quiet` | 0/1 | `1` | suppress feedback |

### Behaviour
`forward`/`backward` step `button_mode` modulo the ring length; a bare mode name outside
the ring is stored as a **negative** `button_mode` (`-1 - index_into(mode_name_list)`), so
`mode_name_list` order is load-bearing. After switching it sets `button_mode_name`, calls
`button()` for every row, then `unpick()` (non-editing) or `deselect()` (editing) and
`refresh_wizard()`. `select_forward`/`select_backward` wrap `mouse_selection_mode` in 0..6
(Atoms/Residues/Chains/Segments/Objects/Molecules/C-alphas).

### Examples
```python
mouse("forward")            # next mode in the ring
mouse("three_button_editing")
mouse("select_forward")     # Atoms → Residues → …
```

### Related
[config_mouse](#config_mouse) · [three_button_viewing](#three_button_viewing) · [edit_mode](#edit_mode)

### Source
`packages/engine/modules/pymol/controlling.py:609-686`; commands.mdx `cmd.mouse`.

---

## config_mouse

### Purpose
Choose which mouse *ring* — the ordered set of modes that `mouse('forward')` cycles
through (three-button, two-button, one-button, maestro, motions, all-modes).

### Syntax
`config_mouse(ring='three_button', quiet=1)`

| Param | Type | Default | Meaning |
|---|---|---|---|
| `ring` | string | `'three_button'` | ring name (`maestro`, `three_button_viewing`, `two_button_editing`, `three_button_all_modes`, `one_button`, …) |
| `quiet` | 0/1 | `1` | suppress feedback |

### Behaviour
Sets `button_mode=0`, replaces the global `mouse_ring`, then calls `cmd.mouse()`. The
in-viewport ButMode block right-clicks open the `mouse_config` menu, which offers
3-Button Motions/Editing/Viewing/Lights/All Modes and 2-Button Editing/Viewing/Lights.

### Examples
```python
config_mouse("two_button_editing")
config_mouse("three_button_all_modes")
```

### Related
[mouse](#mouse) · [button](#button)

### Source
`packages/engine/modules/pymol/controlling.py:127-202`; commands.mdx `cmd.config_mouse`.

---

## edit_mode

### Purpose
Legacy toggle between the `*_viewing` and `*_editing` variant of the current mouse-mode
family. Used by the Builder panel, which calls `edit_mode(1)` on show.

### Syntax
`edit_mode(active=1, quiet=1)`

| Param | Type | Default | Meaning |
|---|---|---|---|
| `active` | 0/1 | `1` | 1 → editing variant, 0 → viewing variant |
| `quiet` | 0/1 | `1` | suppress feedback |

### Behaviour
Switches the family (e.g. `three_button_viewing` ↔ `three_button_editing`) without
changing the ring. No-op if the current ring has no editing variant.

### Examples
```python
edit_mode(1)   # enter editing (Builder does this on open)
edit_mode(0)
```

### Related
[mouse](#mouse) · [Builder dialog](#builder-dialog)

### Source
`packages/engine/modules/pymol/controlling.py:688-717`; Builder `builder.py:1341`; commands.mdx `cmd.edit_mode`.

---

## mask

### Purpose
Make atoms unpickable by the mouse — useful when a foreground molecule sits in front of
a background one and you want clicks to ignore the background.

### Syntax
`mask(selection='(all)', quiet=1)`

| Param | Type | Default | Meaning |
|---|---|---|---|
| `selection` | string | `'(all)'` | atoms to make unselectable |
| `quiet` | 0/1 | `1` | suppress feedback |

### Behaviour
Clears the per-atom `pickable` flag so `SceneDoXYPick` cannot hit those atoms;
`unmask` restores it. This affects mouse picking only, not selection algebra.

### Examples
```python
mask("polymer")
mask("chain B")
```

### Related
[unmask](#unmask) · [button](#button)

### Source
`packages/engine/modules/pymol/controlling.py:870-925`; commands.mdx `cmd.mask`.

---

## unmask

### Purpose
Reverse `mask` — restore mouse pickability of the indicated atoms.

### Syntax
`unmask(selection='(all)', quiet=1)`

| Param | Type | Default | Meaning |
|---|---|---|---|
| `selection` | string | `'(all)'` | atoms to make selectable again |
| `quiet` | 0/1 | `1` | suppress feedback |

### Behaviour
Re-sets the per-atom `pickable` flag masked by `mask`. Symmetric inverse; safe on
already-pickable atoms.

### Examples
```python
unmask("all")
```

### Related
[mask](#mask)

### Source
`packages/engine/modules/pymol/controlling.py:870-925`; commands.mdx `cmd.unmask`.

---

## set_key

### Purpose
Bind a Python function or a PyMOL command string to a redefinable key. Also usable as a
decorator. This is the programmatic backing of the Keyboard Shortcut editor.

### Syntax
`set_key(key, fn=None, arg=(), kw={})`

| Param | Type | Default | Meaning |
|---|---|---|---|
| `key` | string | — | e.g. `F1`, `left`, `CTRL-A`, `ALT-9`, `CTSH-F5` |
| `fn` | callable/string | `None` | function to call, or (PyMOL ≥1.6.1) a command string |
| `arg` | tuple | `()` | positional args passed to `fn` |
| `kw` | dict | `{}` | keyword args passed to `fn` |

### Behaviour
`key.rpartition('-')` must yield a modifier in `['', 'SHFT', 'CTRL', 'CTSH', 'ALT']`;
multi-char names (lowercased unless they start with `F`) must be in `special_key_names`
(`F1..F12`, `left, up, right, down, pgup, pgdn, home, end, insert`); single letters need
a modifier and cannot use `SHFT` alone. Stores into `cmd.key_mappings[key]` as either a
command string (run via `cmd.do`) or a `(fn, arg, kw)` triple. Redefinable set:
`F1..F12`, `left/right/pgup/pgdn/home/insert`, `CTRL-A..Z`, `ALT-0..9`, `ALT-A..Z`.
`CTRL-S/E/O/M` and `up/down` are reserved.

### Examples
```python
set_key("F3", "ray")
set_key("CTRL-B", cmd.bg_color, ("black",))
```

### Related
[Keyboard Shortcut editor](#keyboard-shortcut-editor) · [Navigation & movie/scene key bindings](#navigation--moviescene-key-bindings)

### Source
`packages/engine/modules/pymol/controlling.py:719-797`; commands.mdx `cmd.set_key`.

---

## editing_ring

### Purpose
Clipboard ring helper for copy/cut/paste/invert of molecular selections — the backing
of `CTRL-C/X/V/I`.

### Syntax
`editing_ring(action)`

| Param | Type | Default | Meaning |
|---|---|---|---|
| `action` | string | — | `copy`, `cut`, `paste`, or `invert` |

### Behaviour
Uses a hidden persistent object created with `cmd.create(..., extract=…)` and restores
`auto_hide_selections` around the operation.

### Examples
```python
editing_ring("copy")
editing_ring("paste")
```

### Related
[CTRL-letter bindings](#ctrl-letter-bindings)

### Source
`packages/engine/modules/pymol/keyboard.py:38-84`; commands.mdx `cmd.editing_ring`.

---

## volume_panel

### Purpose
Open the interactive Volume Color Map Editor for a named volume object — the command
entry point for the dialog described in [Volume Color Map Editor](#volume-color-map-editor).

### Syntax
`volume_panel(name, quiet=1, _noqt=0)`

| Param | Type | Default | Meaning |
|---|---|---|---|
| `name` | str | — | name of the volume object |
| `quiet` | 0/1 | `1` | suppress feedback |
| `_noqt` | 0/1 | `0` | skip the Qt window (headless) |

### Behaviour
Reached from the internal `A > volume > panel` menu. Caches one panel per volume object
name (`_volume_windows_qt`). The panel loads the histogram and current ramp on open.

### Examples
```python
volume_panel("density")
```

### Related
[Volume Color Map Editor](#volume-color-map-editor)

### Source
`packages/engine/modules/pymol/colorramping.py:183-227`; commands.mdx `cmd.volume_panel`.

---

## three_button_viewing

### Purpose
The default UX mode: rotate/translate/zoom with L/M/R, box-select on Shift, pick/center
via single clicks. Selected by `config_mouse('three_button')`.

### Syntax
Mode binding matrix (`w` = wheel):

| | none | shft | ctrl | ctsh | alt |
|---|---|---|---|---|---|
| L | `rota` | `+Box` | `move` | `Sele` | `move` |
| M | `move` | `-Box` | `pkat` | `orig` | `none` |
| R | `movz` | `clip` | `pk1` | `clip` | `none` |
| Wheel | `slab` | `movs` | `mvsz` | `movz` | — |

### Behaviour
Single: L=`+/-`, M=`cent`, R=`menu` (Single L+alt/+ctrl=`cent`). Double: L=`menu`,
M=`none`, R=`pkat`. `rota` is the virtual trackball (`scale = 0.45*min(W,H)`), `movz` is
trans-Z/zoom, `clip` shifts near+far by `dx/10`,`dy/10`.

### Examples
```python
config_mouse("three_button")   # ring default lands here
```

### Related
[three_button_editing](#three_button_editing) · [Mouse action codes](#mouse-action-codes)

### Source
`packages/engine/modules/pymol/controlling.py:320-348`; `docs/input-mouse-keyboard.md` §7.1.

---

## three_button_editing

### Purpose
Editing mode: L rotates but Shift/Ctrl rotate objects, torsion fragments, and pick
bonds; used when building/modifying molecules.

### Syntax
| | none | shft | ctrl | ctsh | alt |
|---|---|---|---|---|---|
| L | `rota` | `roto` | `torf` | `mova` | `move` |
| M | `move` | `movo` | `+/-` | `orig` | `none` |
| R | `movz` | `mvoz` | `pktb` | `clip` | `none` |
| Wheel | `slab` | `movs` | `mvsz` | `movz` | — |

### Behaviour
Single: L=`pkat`, M=`cent`, R=`menu`. Double: L=`torf`, M=`drgm`, R=`pktb`. `torf`
rotates a fragment about a bond; `mova` moves an atom; `pktb` prepares a torsion drag
(`Threshold=3px`). Reached via `edit_mode(1)` or `config_mouse('three_button_editing')`.

### Examples
```python
config_mouse("three_button_editing")
```

### Related
[three_button_viewing](#three_button_viewing) · [edit_mode](#edit_mode) · [Builder dialog](#builder-dialog)

### Source
`packages/engine/modules/pymol/controlling.py:349-377`; `docs/input-mouse-keyboard.md` §7.2.

---

## three_button_motions

### Purpose
Motion-capture mode: Shift variants edit TTT/movie *view* transforms (`rotv`/`movv`)
rather than objects — for authoring camera and object motion into movies.

### Syntax
| | none | shft | ctrl | ctsh | alt |
|---|---|---|---|---|---|
| L | `rota` | `rotv` | `torf` | `mova` | `move` |
| M | `move` | `movv` | `pkat` | `orig` | `none` |
| R | `movz` | `mvvz` | `pktb` | `clip` | `none` |
| Wheel | `slab` | `movs` | `mvsz` | `movz` | — |

### Behaviour
Single: L=`pkat`, M=`cent`, R=`menu`. Double: L is declared `menu` then overwritten by
`torf` (a latent upstream duplicate-row bug the port preserves), M=`drgm`, R=`pktb`.
`movie_auto_store` grabs the object and sets `ReinterpolateFlag` during view drags.

### Examples
```python
config_mouse("three_button_motions")
```

### Related
[three_button_viewing](#three_button_viewing) · [three_button_editing](#three_button_editing)

### Source
`packages/engine/modules/pymol/controlling.py:378-407`; `docs/input-mouse-keyboard.md` §7.3.

---

## three_button_lights

### Purpose
Light-editing mode: Shift+L/M/R edit the direction/position/Z of the currently selected
light (`edit_light`, clamped 1..9).

### Syntax
| | none | shft | ctrl | ctsh | alt |
|---|---|---|---|---|---|
| L | `rota` | `rotl` | `none` | `none` | `none` |
| M | `move` | `movl` | `none` | `none` | `none` |
| R | `movz` | `mvzl` | `none` | `none` | `none` |
| Wheel | `slab` | `movs` | `mvsz` | `movz` | — |

### Behaviour
Single: M=`cent`, R=`menu`, L+alt=`cent`; Double all `none`. `rotl`/`movl`/`mvzl` mutate
the `light`/`light2`… setting vector by `0.01*d`.

### Examples
```python
config_mouse("three_button_lights")
```

### Related
[three_button_viewing](#three_button_viewing)

### Source
`packages/engine/modules/pymol/controlling.py:235-262`; `docs/input-mouse-keyboard.md` §7.4.

---

## three_button_maestro

### Purpose
Schrödinger-Maestro-style bindings: L is box-select by default, M rotates, R translates.

### Syntax
| | none | shft | ctrl | ctsh | alt |
|---|---|---|---|---|---|
| L | `box` | `+Box` | `+/-` | `Sele` | `move` |
| M | `rota` | `-Box` | `irtz` | `orig` | `none` |
| R | `move` | `clip` | `pk1` | `clip` | `none` |
| Wheel | `imvz` | `movs` | `none` | `slab` | — |

### Behaviour
Single: L=`sele`, M=`cent`, R=`menu`; L+shft=`+/-`. Double: L=`menu`, M=`none`, R=`pkat`.
`w,ctrl=none` is deliberate ("disable since ctrl-middle is irtz"). `irtz` is inverted
rotate-Z; `imvz` inverted trans-Z.

### Examples
```python
config_mouse("maestro")
```

### Related
[three_button_viewing](#three_button_viewing)

### Source
`packages/engine/modules/pymol/controlling.py:291-319`; `docs/input-mouse-keyboard.md` §7.5.

---

## two_button_viewing

### Purpose
Two-button mode for trackpads/laptops: L rotates, R zooms; middle button unused.

### Syntax
| | none | shft | ctrl | ctsh | alt |
|---|---|---|---|---|---|
| L | `rota` | `pk1` | `move` | `sele` | `move` |
| M | `none` | `none` | `none` | `none` | `none` |
| R | `movz` | `clip` | `pkat` | `cent` | `none` |
| Wheel | `none` | `none` | `none` | `none` | — |

### Behaviour
Single: L=`pkat`, R=`menu`, L+alt=`cent`. Double: L=`menu`, R=`cent`. Part of the
`two_button` ring (cycles viewing → selecting).

### Examples
```python
config_mouse("two_button")
```

### Related
[two_button_selecting](#two_button_selecting) · [two_button_editing](#two_button_editing)

### Source
`packages/engine/modules/pymol/controlling.py:408-435`; `docs/input-mouse-keyboard.md` §7.6.

---

## two_button_selecting

### Purpose
The selecting half of the two-button ring: L Shift-drags a box-add, toggles atoms.

### Syntax
| | none | shft | ctrl | ctsh | alt |
|---|---|---|---|---|---|
| L | `rota` | `+Box` | `+/-` | `sele` | `move` |
| M | `none` | `none` | `none` | `none` | `none` |
| R | `movz` | `-Box` | `pkat` | `cent` | `none` |
| Wheel | `none` | `none` | `none` | `none` | — |

### Behaviour
Single: L=`+/-`, R=`menu`, L+alt=`cent`. Double: L=`menu` (declared twice), M=`none`,
R=`cent`.

### Examples
```python
mouse("two_button_selecting")
```

### Related
[two_button_viewing](#two_button_viewing)

### Source
`packages/engine/modules/pymol/controlling.py:436-463`; `docs/input-mouse-keyboard.md` §7.7.

---

## two_button_editing

### Purpose
Two-button editing: Shift picks atoms, Ctrl sets torsion bonds, Ctrl+Shift rotates
fragments — building on a two-button device.

### Syntax
| | none | shft | ctrl | ctsh | alt |
|---|---|---|---|---|---|
| L | `rota` | `pkat` | `torf` | `rotf` | `move` |
| M | `none` | `none` | `none` | `none` | `none` |
| R | `movz` | `clip` | `pktb` | `movf` | `none` |
| Wheel | `none` | `none` | `none` | `none` | — |

### Behaviour
Single: L=`pkat`, R=`menu`, L+alt=`cent`. Double: L=`menu`, R=`cent`. In the
`two_button_editing` ring (editing → viewing → selecting).

### Examples
```python
config_mouse("two_button_editing")
```

### Related
[three_button_editing](#three_button_editing)

### Source
`packages/engine/modules/pymol/controlling.py:464-491`; `docs/input-mouse-keyboard.md` §7.8.

---

## two_button_lights

### Purpose
Two-button light editing; reachable only via `mouse('two_button_lights')`, not through a
default ring.

### Syntax
| | none | shft | ctrl | ctsh | alt |
|---|---|---|---|---|---|
| L | `rota` | `rotl` | `movl` | `none` | `none` |
| M | `none` | `none` | `none` | `none` | `none` |
| R | `movz` | `mvzl` | `none` | `cent` | `none` |
| Wheel | `none` | `none` | `none` | `none` | — |

### Behaviour
Single: R=`menu`, L+alt=`cent`. Double: L=`menu`, R=`cent`.

### Examples
```python
mouse("two_button_lights")
```

### Related
[three_button_lights](#three_button_lights)

### Source
`packages/engine/modules/pymol/controlling.py:263-290`; `docs/input-mouse-keyboard.md` §7.9.

---

## one_button_viewing

### Purpose
Single-button mode (tablet/one-button mouse): every action is reached by stacking
modifiers on the left button. The only mode using `alsh`/`ctal`/`ctas`.

### Syntax
| | none | shft | ctrl | ctsh | alt | alsh | ctal | ctas |
|---|---|---|---|---|---|---|---|---|
| L | `rota` | `+Box` | `movZ` | `clip` | `move` | `-Box` | `none` | `none` |
| M/R | `none` everywhere | | | | | | | |
| Wheel | `slab` | `movs` | `mvsz` | `movz` | — | — | — | — |

### Behaviour
Single L: none=`+/-`, ctrl=`menu`, ctsh=`pkat`, alt=`cent`. Double: L=`menu`.
`SceneMouse` forces "possible single click" on whenever `button_mode_name` starts with
`'1'`.

### Examples
```python
config_mouse("one_button")
```

### Related
[three_button_viewing](#three_button_viewing)

### Source
`packages/engine/modules/pymol/controlling.py:492-534`; `docs/input-mouse-keyboard.md` §7.10.

---

## Mouse action codes

### Purpose
The vocabulary of ButMode *actions* that any button slot can be bound to — the atomic
verbs (rotate, translate, zoom, clip, pick, select, drag, torsion, center, menu) shared
by every mode above. Each has a 5-char on-screen label.

### Syntax
Representative codes (py name → label → meaning):

| py name | label | meaning |
|---|---|---|
| `rota` | `Rota` | rotate XYZ (virtual trackball) |
| `move` | `Move` | translate XY |
| `movz` | `MovZ` | translate Z / zoom |
| `rotz`/`irtz` | `RotZ`/`IRtZ` | rotate about Z (inverted variant) |
| `clip` | `Clip` | clip near+far |
| `clpn`/`clpf` | `ClpN`/`ClpF` | clip near only / far only |
| `pkat` | `PkAt` | pick atom (multi-pick editor) |
| `pk1` | `Pk1 ` | pick single atom → `pk1` |
| `pkbd`/`pktb` | `PkBd`/`PkTB` | pick bond / pick torsion bond |
| `rotf`/`torf`/`movf` | `RotF`/`TorF`/`MovF` | rotate / torsion / move fragment |
| `mova`/`mvaz` | `MovA`/`MvAZ` | move atom (Z variant) |
| `orig` | `Orig` | set origin at atom |
| `cent` | `Cent` | center on atom |
| `menu` | `Menu` | context pop-up |
| `sele`/`+/-` | `Sele`/`+/-  ` | set / toggle active selection |
| `+box`/`-box`/`box` | `+Box`/`-Box`/` Box ` | box add / subtract / set selection |
| `slab`/`movs`/`mvsz` | `Slab`/`MovS`/`MvSZ` | scale / move slab, move-slab-and-zoom (wheel) |
| `roto`/`movo`/`mvoz` | `RotO`/`MovO`/`MvOZ` | rotate / move object |
| `rotv`/`movv`/`mvvz` | `RotV`/`MovV`/`MvVZ` | rotate / move view (TTT/movie) |
| `rotl`/`movl`/`mvzl` | `RotL`/`MovL`/`MvzL` | edit light direction / position / Z |
| `drgm`/`drgo` | `DrgM`/`DrgO` | drag molecule / object |
| `clik` | `Clik` | simple click (fires click-ready callback) |

### Behaviour
`ButModeTranslate(button, mod)` maps a physical button+modifier to a slot (0..79) and
the stored action code; the action is re-resolved on every drag sample with that
sample's modifier, so releasing Shift mid-drag changes the action mid-drag. Wheel codes
are further re-mapped by scroll direction. Bind any code with `button(...)`.

### Examples
```python
button("single_left", "none", "cent")   # single-left click centers
button("l", "ctrl", "pk1")
```

### Related
[button](#button) · [Mouse wheel bindings](#mouse-wheel-bindings)

### Source
`packages/engine/layer1/ButMode.h:23-113`, `ButMode.cpp:500-555`, `controlling.py:57-123`; `docs/input-mouse-keyboard.md` §4.

---

## Mouse wheel bindings

### Purpose
The four wheel slots (none/Shift/Ctrl/Ctrl+Shift, plus Alt variants) that drive slab and
zoom by scrolling.

### Syntax
Default wheel row across most modes: `slab` / `movs` / `mvsz` / `movz`.

### Behaviour
Qt sends a wheel event as a synthetic down+up pair on button 3 (up) / 4 (down); shift
lets horizontal-scroll delta substitute for vertical. `ButModeTranslate` resolves the
wheel slot then remaps by direction: `Slab`→scale slab ±`0.2*mouse_wheel_scale`,
`MovS`→move slab ±`0.1*mouse_wheel_scale`, `MovZ`→zoom ±`0.1*mouse_wheel_scale*(front+back)/2`
(`mouse_wheel_scale` default 0.5). Wheel over the ButMode block cycles modes backward.

### Examples
```python
button("wheel", "ctsh", "movz")   # Ctrl+Shift wheel zooms
```

### Related
[Mouse action codes](#mouse-action-codes) · [button](#button)

### Source
`packages/engine/layer1/ButMode.cpp:603-757`, `SceneMouse.cpp:717-802`; `docs/input-mouse-keyboard.md` §4.2, §10.

---

## Navigation & movie/scene key bindings

### Purpose
The default bindings on the arrow / navigation keys (and their SHFT/CTRL/ALT/CTSH
variants) for stepping movie frames and scenes and zooming.

### Syntax
Verbatim from `shortcut_dict.py` (unmodified subset):

| Key | Command |
|---|---|
| `left` / `right` | `_ backward` / `_ forward` (movie frame) |
| `pgup` / `pgdn` | `scene action=previous` / `scene action=next` |
| `home` | `zoom animate=-1` |
| `end` | `mtoggle` (play/pause) |
| `insert` | `rock` |
| `CTRL-pgup` / `CTRL-pgdn` | `scene new, insert_before` / `insert_after` |
| `CTRL-end` | `scene new, store` |
| `CTRL-insert` | `scene auto, store` |

### Behaviour
These live in `cmd.shortcut_dict` and are dispatched through `internal._special`, which,
after the modifier-prefixed name lookup, falls back to **scene** and **view** name lookup
(with prefix auto-completion). All are rebindable via `set_key` except reserved `up`/`down`.

### Examples
```python
set_key("home", "zoom animate=2")   # rebind Home
```

### Related
[set_key](#set_key) · [Function-key scene bindings](#function-key-scene-bindings)

### Source
`packages/engine/modules/pymol/shortcut_dict.py:10-49`; `docs/input-mouse-keyboard.md` §15.4.

---

## Function-key scene bindings

### Purpose
The `CTRL-Fn` / `CTSH-Fn` defaults that store scenes into named slots `F1`..`F12` and
`SHFT-F1`..`SHFT-F12`.

### Syntax
For n = 1..12: `CTRL-Fn` → `scene Fn, store`, `CTSH-Fn` → `scene SHFT-Fn, store`.

### Behaviour
Bare `F1`..`F12` and `SHFT-F1`..`SHFT-F12` are **not** in the table; they fall through
`_special` to scene/view name lookup — which is exactly how a scene stored under `F3` is
recalled by pressing `F3`. Store and recall are thus asymmetric bindings.

### Examples
```
# press CTRL-F5 to store the current view as scene "F5"; press F5 to recall it
```

### Related
[Navigation & movie/scene key bindings](#navigation--moviescene-key-bindings) · [Scene Panel](#scene-panel)

### Source
`packages/engine/modules/pymol/shortcut_dict.py:112-135`; `docs/input-mouse-keyboard.md` §15.4.

---

## CTRL-letter bindings

### Purpose
The default `CTRL-A..Z` editing/clipboard/wizard shortcuts.

### Syntax
| Key | Command |
|---|---|
| `CTRL-A` | `select sele, all, 1` |
| `CTRL-C`/`CTRL-X`/`CTRL-V` | `editing_ring copy` / `cut` / `paste` |
| `CTRL-I` | `editing_ring invert` |
| `CTRL-F` | `wizard find` |
| `CTRL-H` | `help edit_keys` |
| `CTRL-L` | `util.ligand_zoom()` |
| `CTRL-T` | `bond;unpick` |
| `CTRL-Y` / `CTRL-Z` | `redo` / `undo` |

### Behaviour
Dispatched through `internal._ctrl` → `CTRL-x`. `CTRL-A`/`CTRL-E` are consumed by
command-line editing when the console has text; `CTRL-S/E/O/M` are reserved and cannot be
rebound. `CTRL-T`/`CTRL-F` collide with browser shortcuts in the web port where
`preventDefault()` cannot recover them.

### Examples
```python
set_key("CTRL-B", "bg_color black")
```

### Related
[editing_ring](#editing_ring) · [set_key](#set_key)

### Source
`packages/engine/modules/pymol/shortcut_dict.py:754-767`; `docs/input-mouse-keyboard.md` §15.4.

---

## ALT-attach bindings

### Purpose
The `ALT-digit` and `ALT-letter` defaults that grow fragments and attach amino acids onto
`pk1` — the keyboard fast-path for the Builder.

### Syntax
- `ALT-1..0`: `editor.attach_fragment('pk1', …)` — `ALT-9` benzene 6,0; `ALT-6` cyclohexane
  7,0; `ALT-0` formaldehyde 2,0; etc.
- `ALT-A..Z`: amino-acid attach — `A` ala, `B` ace, `C` cys, … `Y` tyr, `Z` nme; `J`
  attaches acetylene. No `ALT-O`, `ALT-U`, `ALT-X`.

### Behaviour
Each runs an `editor.attach_*` call against the current `pk1` pick, so they only do
something when an atom is picked. Dispatched via `internal._alt` → `ALT-X`.

### Examples
```
# pick an atom, then press ALT-9 to attach a phenyl ring
```

### Related
[Builder dialog](#builder-dialog) · [CTSH-letter editing bindings](#ctsh-letter-editing-bindings)

### Source
`packages/engine/modules/pymol/shortcut_dict.py:50-82`; `docs/input-mouse-keyboard.md` §15.4.

---

## CTSH-letter editing bindings

### Purpose
The `CTSH-A..Z` (Ctrl+Shift+letter) defaults for element replacement, charge, valence and
undo/redo — chemical editing from the keyboard.

### Syntax
| Key | Command |
|---|---|
| `CTSH-C`/`N`/`O`/`S`/`F`/`P` | `replace C,4,4` / `N,4,3` / `O,4,2` / `S,4,2` / `F,1,1` / `P,4,1` |
| `CTSH-B`/`L`/`I` | `replace Br,1,1` / `Cl,1,1` / `I,1,1` |
| `CTSH-G`/`Y` | `replace H,1,1` / `attach H,1,1` |
| `CTSH-D` | `remove_picked` |
| `CTSH-E`/`W` | `invert` / `cycle_valence` |
| `CTSH-J`/`K`/`U` | `alter pk1,formal_charge=-1./1./0.` |
| `CTSH-R`/`T` | `h_fill` / `bond;unpick` |
| `CTSH-A`/`Z`/`X` | `redo` / `undo` / `cmd.auto_measure()` |

### Behaviour
Dispatched through `internal._ctsh` → `CTSH-x`. All operate on the current `pk1`/`pk2`
picks. Rebindable via `set_key` (`CTSH-` prefix).

### Examples
```
# pick an atom, press CTSH-N to replace it with nitrogen
```

### Related
[ALT-attach bindings](#alt-attach-bindings) · [Builder dialog](#builder-dialog)

### Source
`packages/engine/modules/pymol/shortcut_dict.py:90-111`; `docs/input-mouse-keyboard.md` §15.4.

---

## Volume Color Map Editor

### Purpose
Interactive editor for a volume object's transfer function — a 2D plot of data value (x)
against a logarithmic alpha axis (y) with draggable color points. Opened from
`A > volume > panel` or `volume_panel(name)`.

### Syntax
No signature (a dialog). Data contracts: `get_volume_histogram(name)` →
`[min,max,mean,stdev,h0..]`; `volume_color(name)` getter → flat `[v,r,g,b,a]*N`;
`volume_color(name, ramp)` setter; named presets `2fofc/fofc/esp/rainbow/rainbow2`.

### Behaviour
Ships as a docked `QDockWidget` ("<name> - Volume Color Map Editor"). The canvas maps
pixels through `convertX/convertY`, `xToData`, and a base-10 `alphaToY`/`yToAlpha` axis
scaled by `amax`. Mouse model: L-click adds a point (Ctrl adds 3 for an isosurface
preset), L-click on a point opens a color dialog, R-click edits its data value, Shift+R
edits alpha, M-click/Shift+L removes it, L-drag moves it, Ctrl+R-drag zooms the data
window; wheel over a value box edits vmin/vmax/amax, wheel elsewhere scales all alphas.
The "Update volume colors in real-time" checkbox (default checked) only suppresses updates
*during* a drag/preview — release always pushes. Buttons: "Get colors as script",
"Reset Data Range", "Help".

### Examples
```python
volume_panel("map1")
volume_color("map1", "2fofc")   # apply a named preset
```

### Related
[volume_panel](#volume_panel) · `volume_ramp_new`, `volume_color`

### Source
`packages/engine/modules/pmg_qt/volume.py` (877 lines); `docs/dialogs-volume-properties-scenes.md` §1. Port: `apps/web/src/features/volume/`.

---

## Properties Inspector

### Purpose
Modeless tree inspector/editor of object-, object-state-, atom- and atom-state-level
fields, settings and matrices for the currently picked atom (`pk1`). Opened from the
"Properties" quick-button.

### Syntax
No signature. Form `props.ui` (400x500): Object combo, State/Atom spinboxes, Refresh
button, two-column `Key`/`Value` tree.

### Behaviour
Reads via `get_object_ttt`, `get_object_settings`, `get_title`, `get_object_matrix`,
`iterate`/`iterate_state`; edits write back via `set_object_ttt`, `set_title`,
`transform_object`, `set`, `set_property`, `alter`/`alter_state`. Changing the
object/state/index inputs drives the pick with `cmd.edit((model,index))`. Keys are never
editable; `model/index/state/oneletter` rows are read-only. Type coercion in a
`get_new_value` closure handles `0x`/`0b` literals for `color`/`reps`/`flags`. `Delete`
in the tree unsets the row. Atom/Atom-State levels hide when `natoms==0`.

### Examples
```
# pick an atom in the viewport, open Properties, edit its b-factor cell
```

### Related
`set_property`, `alter`, `iterate` · [Builder dialog](#builder-dialog)

### Source
`packages/engine/modules/pmg_qt/properties_dialog.py` (415 lines) + `forms/props.ui`; `docs/dialogs-volume-properties-scenes.md` §2. Port: `apps/web/src/features/properties/`.

---

## Scene Panel

### Purpose
Modeless panel listing stored scenes with server-rendered PNG thumbnails; add, update,
delete, rename, recall and reorder scenes. Opened from `Scene > Scenes...`.

### Syntax
No signature. `QTableWidget` with `Name` / `Scene Preview` columns (100 px rows),
"Add Scene" / "Update Scene" / "Delete Scene" buttons.

### Behaviour
Data from `get_scene_list()` and `get_scene_thumbnail(name)` (raw PNG bytes). Add →
`scene('new','append')`; Update → `scene(name,'update')`; Delete → `scene(name,'clear')`;
double-click row → `scene(name,'recall')`; rename cell → `scene(old,'rename',new_key=new)`;
drag vertical header → `scene_order(' '.join(names))`. Rename rejects spaces/blanks
(console-only). Reorder-vs-rename is disambiguated by "more than one row moved". Refresh
is polling-based (repaint + window-activate events).

### Examples
```python
scene("new", "append")
scene_order("F1 F2 F3")
```

### Related
[Function-key scene bindings](#function-key-scene-bindings) · `scene`, `scene_order`

### Source
`packages/engine/modules/pmg_qt/scene_bin_gui.py` (397 lines); `docs/dialogs-volume-properties-scenes.md` §3. Port: `apps/web/src/features/scenes/`.

---

## Advanced Settings editor

### Purpose
Modeless flat table of *every* setting (from `setting.get_name_list()`) with a live
filter, for reading and editing setting values by name. Opened from `Setting > Edit All...`.

### Syntax
No signature. Filter `QLineEdit` + a `QTableView` (name column read-only, value column
editable; booleans render as checkboxes).

### Behaviour
Each row is typed via `get_setting_tuple(index)`: booleans → checkable item, int/string →
text, float/float3/color → `cmd.get(index)` text. Editing calls
`cmd.set(index, value, log=1, quiet=0)`. **No validation and no auto-refresh** — a bad
value only prints, and values changed from the command line go stale until reopened.

### Examples
```
# Setting > Edit All..., filter "cartoon_transparency", edit the value cell
```

### Related
`set`, `get` · settings reference

### Source
`packages/engine/modules/pmg_qt/advanced_settings_gui.py` (99 lines); `docs/dialogs-volume-properties-scenes.md` §5. Port: `apps/web/src/features/dialogs/AdvancedSettings.tsx`, `settings/AdvancedSettingsTable.tsx`.

---

## Text/Python Editor

### Purpose
A minimal `QMainWindow` code editor with Python/PML/plain syntax highlighting, used to
edit `pymolrc` and script files. Opened from `File > Edit pymolrc`.

### Syntax
No signature. Menus: File (Open Ctrl+O, Save Ctrl+S, Save as Ctrl+Shift+S), Syntax
(exclusive Python/PML/Plain Text).

### Behaviour
`QPlainTextEdit` with a monospace font and a right-click context menu (standard edit
actions + "Select Font..."). `_open` auto-selects syntax by extension (`.py`→python,
`.pml`/`pymolrc`→pml, else plain); there is no `plain.py` highlighter so plain simply
leaves text unhighlighted. Save/Open guard unsaved changes with a modal
"Save changes?" dialog. `edit_pymolrc` prompts to pick among active rc files or create a
new one. Modeless, one instance per invocation (not cached).

### Examples
```
# File > Edit pymolrc  →  edit and save ~/.pymolrc
```

### Related
[Advanced Settings editor](#advanced-settings-editor)

### Source
`packages/engine/modules/pmg_qt/TextEditor.py` (195 lines); `docs/dialogs-volume-properties-scenes.md` §6. Port: `apps/web/src/features/texteditor/`.

---

## Keyboard Shortcut editor

### Purpose
Modeless table of every key binding — key, command (editable), description — with
create/delete/reset/save, backing the `set_key` map. Opened from
`Setting > Keyboard Shortcuts...`.

### Syntax
No signature. Filter `QLineEdit` + `QTableView` (columns `Key`, `Command (click to edit)`,
`Description`); buttons Create New / Delete Selected / Reset Selected / Reset All / Save.

### Behaviour
Rows come from `cmd.shortcut_dict` (135 defaults) reconciled with `cmd.key_mappings` and
the saved file by `ShortcutManager`. Editing the command cell calls `set_key(key,text)`;
deleting a bound-with-default key shows the literal `"Deleted"`. "Create New" opens a
`create_shortcut` sub-dialog whose `keyEdit` captures a live key event and converts it to
PyMOL notation (Control/Meta→`CTRL`, Ctrl+Shift→`CTSH`, Alt→`ALT`, Shift→`SHFT`);
reserved keys (`CTRL-S/E/O/M`, `up`, `down`) are silently rejected. Changing an existing
binding pops the modal `change_confirm` dialog. Save writes
`~/.pymol/shortcuts_save.json`, loaded at startup.

### Examples
```python
set_key("F4", "orient")   # equivalent to editing the F4 row in the dialog
```

### Related
[set_key](#set_key) · [CTRL-letter bindings](#ctrl-letter-bindings)

### Source
`packages/engine/modules/pmg_qt/shortcut_menu_gui.py` (415 lines), `shortcut_manager.py`, `shortcut_dict.py`; `docs/dialogs-volume-properties-scenes.md` §4. Port: `apps/web/src/features/shortcuts/`.

---

## Builder dialog

### Purpose
The floating molecular-builder dock: three tabs (Chemical / Protein / Nucleic Acid) of
fragment, residue and nucleotide buttons plus three always-visible rows of editing actions
(H fill/add, invert, delete, charge, bond order, clean, sculpt, fix/restrain, undo/redo).
Opened from `open_builder_panel` / the "Builder" quick-button.

### Syntax
No signature. It is a control-plane surface: every button issues `cmd.*` calls (`replace`,
`attach_fragment`, `attach_amino_acid`, `attach_nuc_acid`, `bond`, `unbond`, `valence`,
`invert`, `remove_picked`, `h_fill`/`h_add`, `sculpt_*`, `undo`/`redo`).

### Behaviour
On show it sets `editor_auto_measure=0`, `auto_overlay=1`, `valence=1` and `edit_mode(1)`.
`collectPicked` drives every bottom-row button: if `pk1..pk4` are already picked it acts
immediately, otherwise it *arms a wizard* (13 `ActionWizard` classes) that publishes a
prompt + button panel and receives `do_pick`/`do_select` callbacks — clicking the same
button twice cancels (toggle semantics). Charge/valence/replace all operate on the picked
selection and call `h_fill`. `Clean` raises `IncentiveOnlyException` in this open-source
tree (no MMFF94 minimizer).

### Examples
```
# open Builder, pick an atom, click "-OMe" to grow a methoxy group
# or click "C" then pick an atom (arms ReplaceWizard) to replace it with carbon
```

### Related
[three_button_editing](#three_button_editing) · [edit_mode](#edit_mode) · [ALT-attach bindings](#alt-attach-bindings)

### Source
`packages/engine/modules/pmg_qt/builder.py` (1579 lines), `packages/engine/modules/pymol/editor.py`; `docs/builder.md`. Port: `apps/web/src/features/builder/`.
