# Input: mouse and keyboard

Map of PyMOL's input path, from the Qt widget down to `SceneDrag`. Every claim is anchored to a
`path:line` in `packages/engine/`, which is unmodified upstream. Where an API does **not** exist
it is called out explicitly as **NOT PRESENT**.

**Where the port stands.** `packages/viewport/src/input/` holds the whole surface:
`mouse.ts` (1:1 pointer forwarding + drag coalescing), `keys.ts` (the `keymapping.py` translation),
`butmode.ts` + `modes.ts` (the 57-action / 80-slot table, mirrored in TypeScript — see §17),
`camera.ts` (RPC-driven actions for a GL-free backend), `coords.ts` (the y-flip and dpr maths of
§2), `coalescer.ts`, `shortcuts.ts`, `mouseConfig.ts`. Resize negotiation is
`packages/viewport/src/resize.ts`; the mouse-mode UI is `apps/web/src/features/mouse/`; key
bindings are `apps/web/src/features/keyboard/` and `apps/web/src/features/shortcuts/`.

---

## 0. Source inventory (what feeds this area)

| File | Role |
|---|---|
| `packages/engine/modules/pmg_qt/pymol_gl_widget.py` | Qt widget: mouse/wheel/gesture → `pymol.button/drag`, DPR handling, reshape |
| `packages/engine/modules/pmg_qt/keymapping.py` | Qt key/modifier/wheel → PyMOL key codes |
| `packages/engine/modules/pmg_qt/pymol_qt_gui.py:50` | Window-level `keyPressEvent` → `pymol.button(...)` |
| `packages/engine/modules/pmg_qt/shortcut_menu_gui.py` | "Keyboard Shortcut Menu" dialog (415 lines) |
| `packages/engine/modules/pymol/controlling.py` | `button()`, `mouse()`, `config_mouse()`, `set_key()`, `edit_mode()`, `mask()`, all mouse-mode tables |
| `packages/engine/modules/pymol/internal.py:388-511` | `_special`, `_ctrl`, `_alt`, `_ctsh`, `_cmmd`, `_invoke_key`, `special_key_codes`, `modifier_keys` |
| `packages/engine/modules/pymol/keyboard.py` | `editing_ring` (cut/copy/paste/invert), `get_default_keys()` |
| `packages/engine/modules/pymol/shortcut_dict.py` | The 100+ default key bindings table |
| `packages/engine/modules/pymol/shortcut_manager.py` | Reconciles defaults / user / saved bindings; reserved keys |
| `packages/engine/modules/pymol/shortcut.py` | `Shortcut` prefix-matcher (used for `button`/`action`/`ring` name abbreviation) |
| `packages/engine/modules/pymol/save_shortcut.py` | Persists to `~/.pymol/shortcuts_save.json` |
| `packages/engine/layer4/Cmd.cpp:3626/3646/3569/3665` | `_button`, `_drag`, `_reshape`, `_sdof` Python entry points |
| `packages/engine/layer5/PyMOL.cpp:2353/2361/2397/2890/2908/2979` | `PyMOL_Key`, `PyMOL_Special`, `PyMOL_Reshape`, `PyMOL_Drag`, `PyMOL_Button`, `PyMOL_SetDefaultMouse` |
| `packages/engine/layer1/Ortho.cpp:2493/2575/841/322` | `OrthoButton`, `OrthoDrag`, `OrthoKey`, `OrthoSpecial` (block hit-test, grab, CLI keys) |
| `packages/engine/layer1/ButMode.cpp` / `.h` | The 80-slot button→action table, `ButModeTranslate`, action code labels |
| `packages/engine/layer1/SceneMouse.cpp` (2036 lines) | `SceneClick` / `SceneDrag` / `SceneRelease` — all viewport semantics |
| `packages/engine/layer1/ScenePicking.cpp:17` | `SceneDoXYPick` — GPU color-pick + `glReadPixels` |
| `packages/engine/layer1/Control.cpp` | Movie control block (mouse), SDOF/spaceball, `ControlRock` |
| `packages/engine/layer3/Executive.cpp:7432` | `ExecutiveSelectRect` — box-select semantics |

---

## 1. The event pipeline

```
Qt event
  → PyMOLGLWidget.mousePressEvent/mouseMoveEvent/wheelEvent   (pymol_gl_widget.py:178-196)
  → pymol2 SingletonPyMOL.button/drag                          (packages/engine/modules/pymol2/__init__.py:46,49)
  → _cmd._button / _cmd._drag                                  (packages/engine/layer4/Cmd.cpp:3626, 3646)
  → PyMOL_Button / PyMOL_Drag                                  (packages/engine/layer5/PyMOL.cpp:2908, 2890)
  → OrthoButton / OrthoDrag                                    (packages/engine/layer1/Ortho.cpp:2493, 2575)
  → Block::click/drag/release of the hit block                 (Ortho.cpp:2536 findBlock)
  → CScene::click → OrthoDefer(...) → SceneClick(...)          (packages/engine/layer1/Scene.cpp:4113-4155)
```

Key architectural facts to preserve:

* **All scene mouse handling is deferred.** `CScene::click/drag/release` only push a lambda onto
  `OrthoDefer` (`packages/engine/layer1/Scene.cpp:4113`, `4118`, `4129`, `4146`); the actual `SceneClick`/`SceneDrag`/
  `SceneRelease` run later on the render/idle thread. `when` (a `UtilGetSeconds` timestamp) is
  captured at enqueue time, because all click/double-click timing uses it.
* **`PyMOL_Button` multiplexes keys and mouse** on the `state` argument
  (`packages/engine/layer5/PyMOL.cpp:2896-2917`): `state == -1` → `PyMOL_Key` (ascii), `state == -2` →
  `PyMOL_Special` (GLUT special code), `state == 0` → mouse down, `state == 1` → mouse up.
* **Modifier mask** is `SHIFT=1, CTRL=2, ALT=4` (`packages/engine/layer1/Ortho.h:20-22`), built on the Qt side by
  `get_modifiers` (`packages/engine/modules/pmg_qt/keymapping.py:44-58`); note Qt **Meta** (⌘ on macOS) is folded into
  the same bit as Control (`keymapping.py:51-52`).
* **Buttons** are `left=0, middle=1, right=2`, wheel-forward=3, wheel-backward=4
  (`pymol_gl_widget.py:45-49`, `packages/engine/layer0/os_gl_glut.h:21-22`), plus synthetic
  `SINGLE_LEFT=100, SINGLE_MIDDLE=101, SINGLE_RIGHT=102, DOUBLE_LEFT=200, DOUBLE_MIDDLE=201,
  DOUBLE_RIGHT=202` (`packages/engine/layer0/os_gl_glut.h:23-28`).

---

## 2. Coordinate system: y-flip, framebuffer scale, reshape

`packages/engine/modules/pmg_qt/pymol_gl_widget.py:170-176`:

```python
def _event_x_y_mod(self, ev):
    pos = ev.position() if hasattr(ev, "position") else ev.pos()
    return (int(self.fb_scale * pos.x()),
            int(self.fb_scale * (self.height() - pos.y())),
            get_modifiers(ev))
```

So PyMOL expects, for every mouse event:

1. **Origin bottom-left.** `y_pymol = (widget_height_in_CSS_px - y_css) * dpr`.
   Note the flip is applied to the *logical* height **before** scaling — reproducing this exactly
   matters for sub-pixel/off-by-one on non-integer DPR.
2. **Device pixels.** x and y are multiplied by `fb_scale = devicePixelRatio`
   (`pymol_gl_widget.py:220`).
3. `fb_scale` is also pushed into the engine as an integer setting:
   `self.cmd.set('display_scale_factor', int(self.fb_scale))` (`pymol_gl_widget.py:222`). That drives
   `_gScaleFactor` (`packages/engine/layer1/Setting.cpp:2946-2951`) and hence `DIP2PIXEL()`
   (`packages/engine/layer0/PyMOLGlobals.h:28-29`), which sizes **every internal-GUI hit rectangle** (e.g.
   `cControlBoxSize DIP2PIXEL(17)` in `packages/engine/layer1/Control.cpp:36`, `SceneScrollBarWidth DIP2PIXEL(13)` in
   `packages/engine/layer1/Scene.h:47`). Changing it triggers `OrthoCommandIn(G, "viewport")`
   (`packages/engine/layer1/Setting.cpp:2951`).
4. **Reshape** is `pymol.reshape(w, h, force)` → `_cmd._reshape` → `PyMOL_Reshape`
   (`packages/engine/layer5/PyMOL.cpp:2397-2405`), which sets `G->Option->winX/winY` then `OrthoReshape`.
   `resizeGL` multiplies by `fb_scale` for QOpenGLWidget only (`pymol_gl_widget.py:209-214`);
   for the legacy QGLWidget path the scaling is done in `paintGL` via `glViewport`
   (`pymol_gl_widget.py:202-206`). **The engine's window size is in device pixels.**

**In the port.** The canvas sends `{x: round(cssX * dpr), y: round((cssH - cssY) * dpr)}` with
`cssH = canvas.clientHeight` (`packages/viewport/src/input/coords.ts`). On `ResizeObserver` /
`devicePixelRatio` change it sends `reshape(wDevice, hDevice, force)` **and then**
`cmd.set('display_scale_factor', round(dpr))`, in that order, mirroring `updateFbScale` +
`resizeGL` (`packages/viewport/src/resize.ts`, which also debounces: a window drag emits one
resize per frame and each costs an FBO re-storage on the engine thread). The engine has no window,
so the browser is the authority on size and the bridge is the authority on what it managed to
allocate; the handshake is last-write-wins.

**Stereo x-wrap.** `OrthoButton` rewrites x through `get_wrap_x` when `WrapXFlag`
(`packages/engine/layer1/Ortho.cpp:2513-2521`, helper at `:204-231`), and `SceneClick`/`SceneDrag` do the same with
`get_stereo_x` (`packages/engine/layer1/SceneMouse.cpp:599-627`) for side-by-side stereo modes. For the web client
(mono) this is inert but must not be broken: send raw coordinates and let the backend decide.

---

## 3. Ortho-level dispatch: blocks, grab, deferral

`OrthoButton` (`packages/engine/layer1/Ortho.cpp:2493-2557`):

* Wheel events are **suppressed while a real button is held**: if `button` is scroll and
  `I->ActiveButton` is 0..2 and different, return immediately (`:2503-2510`).
* On `P_GLUT_DOWN`: `I->ActiveButton = button`; target block = `I->GrabbedBy` if set, else
  `findBlock(x,y)` (`:2531-2540`). `findBlock` iterates `Blocks` **in reverse** and calls
  `recursiveFind` (`:2980-2990`).
* On `P_GLUT_UP`: release is delivered to `GrabbedBy` **and** to `ClickedIn`
  (`:2543-2556`) — i.e. potentially twice. Faithful reimplementation should just forward the event and
  let the backend do this.
* Blocks attached: Scene (`cOrthoScene`, `packages/engine/layer1/Scene.cpp:4243`), and as `cOrthoTool`: ButMode
  (`packages/engine/layer1/ButMode.cpp:575`), Control (`packages/engine/layer1/Control.cpp:862`), Movie (`packages/engine/layer1/Movie.cpp:56`),
  Seq (`packages/engine/layer1/Seq.cpp:710`), Wizard (`packages/engine/layer1/Wizard.cpp:835`), Executive/object panel
  (`packages/engine/layer3/Executive.cpp:16671`), PopUp menus (`packages/engine/layer4/PopUp.cpp:263`), plus hidden Pop
  (`packages/engine/layer1/Pop.cpp:71`).
* `OrthoGrab`/`OrthoUngrab` (`:1191`, `:1215`) implement pointer capture. `OrthoFakeDrag`
  (`:305-310`) replays the last drag at `LastX/LastY/LastModifiers` — used for timing-driven pop-ups;
  it is triggered from Python via `cmd._fake_drag` (`packages/engine/modules/pymol/cmd.py:171`, `packages/engine/layer4/Cmd.cpp:540`).

**In the port.** Every internal-GUI block is a React component, so clicks that land on chrome are
never forwarded to `_button`; only the 3D canvas forwards. `OrthoGrab` semantics still apply
*inside* the canvas (box-select rubber band, scene-button drag), which is why the canvas takes
`setPointerCapture` on pointerdown and releases it on pointerup.

---

## 4. The button→action table (`ButMode`)

### 4.1 Table shape

`CButMode::Mode[cButModeInputCount]` with `cButModeInputCount = 80`
(`packages/engine/layer1/ButMode.h:216`). Slot layout (`ButMode.h:118-214`):

| Slots | Meaning |
|---|---|
| 0,1,2 | L/M/R, no modifier |
| 3,4,5 | L/M/R + Shift |
| 6,7,8 | L/M/R + Ctrl |
| 9,10,11 | L/M/R + Ctrl+Shift |
| 12,13,14,15 | Wheel: none / Shift / Ctrl / CtrlShift |
| 16,17,18 | Double L/M/R (no mod) |
| 19,20,21 | Single L/M/R (no mod) |
| 22–27 | Double/Single L/M/R + Shift |
| 28–33 | + Ctrl |
| 34–39 | + CtrlShift |
| 40–45 | + Alt |
| 46–51 | + Alt+Shift |
| 52–57 | + Ctrl+Alt |
| 58–63 | + Ctrl+Alt+Shift |
| 64,65,66,67 | Wheel + Alt / AltShift / CtrlAlt / CtrlAltShift |
| 68–70 | L/M/R + Alt |
| 71–73 | + Alt+Shift |
| 74–76 | + Ctrl+Alt |
| 77–79 | + Ctrl+Alt+Shift |

### 4.2 `ButModeTranslate(G, button, mod)` (`packages/engine/layer1/ButMode.cpp:603-757`)

* L/M/R → base 0/1/2, then `+3` Shift, `+6` Ctrl, `+9` CtSh, `+68` Alt, `+71` AltShift,
  `+74` CtrlAlt, `+77` CtrlAltShift (`:730-756`).
* Wheel → slot 12..15 by modifier, then **re-mapped by direction** (`:617-678`):
  `Slab` → `ScaleSlabExpand/Shrink`; `MovS` → `MoveSlabForward/Backward`;
  `MvSZ` → `MoveSlabAndZoomForward/Backward`; `IMSZ` → inverted; `MovZ` → `ZoomForward/Backward`;
  `IMvZ` → inverted. Anything else returns `-1` (wheel does nothing).
* Single/Double → base 16..21, then `+6` Shift, `+12` Ctrl, `+18` CtSh, `+24` Alt, `+30` AltShift,
  `+36` CtrlAlt, `+42` CtrlAltShift (`:678-726`).
* `ButModeCheckPossibleSingleClick` (`:583-601`) returns true iff the corresponding *single* slot is
  bound (`>= 0`).

### 4.3 Action codes and their on-screen 5-char labels

From `packages/engine/layer1/ButMode.h:23-113` and the labels in `ButModeInit` (`packages/engine/layer1/ButMode.cpp:500-555`), and
the Python names in `packages/engine/modules/pymol/controlling.py:57-123`:

| # | py name | label | meaning |
|---|---|---|---|
| 0 | `rota` | `Rota` | rotate XYZ (virtual trackball) |
| 1 | `move` | `Move` | translate XY |
| 2 | `movz` | `MovZ` | translate Z / zoom |
| 3 | `clip` | `Clip` | clip near+far |
| 4 | `rotz` | `RotZ` | rotate about Z |
| 5 | `clpn` | `ClpN` | clip near |
| 6 | `clpf` | `ClpF` | clip far |
| 7,8,9 | `lb`,`mb`,`rb` | ` lb `,` mb `,` rb ` | legacy set selection lb/mb/rb |
| 10,11,12 | `+lb`,`+mb`,`+rb` | `+lb `… | legacy add to lb/mb/rb |
| 13 | `pkat` | `PkAt` | pick atom (multi-pick editor) |
| 14 | `pkbd` | `PkBd` | pick bond |
| 15 | `rotf` | `RotF` | rotate fragment |
| 16 | `torf` | `TorF` | torsion fragment |
| 17 | `movf` | `MovF` | move fragment |
| 18 | `orig` | `Orig` | set origin at atom |
| 19,20,21 | `+lbx`,`-lbx`,`lbbx` | `+lBx`,`-lBx`,`lbBx` | deprecated box selects |
| 22 | `none` | `  -  ` | unbound |
| 23 | `cent` | `Cent` | center on atom |
| 24 | `pktb` | `PkTB` | pick torsion bond |
| 25 | `slab` | `Slab` | scale slab (wheel) |
| 26 | `movs` | `MovS` | move slab (wheel) |
| 27 | `pk1` | `Pk1 ` | pick single atom → `pk1` |
| 28 | `mova` | `MovA` | move atom |
| 29 | `menu` | `Menu` | context pop-up |
| 30 | `sele` | `Sele` | set active selection |
| 31 | `+/-` | `+/-  ` | toggle atom in selection |
| 32 | `+box` | `+Box` | box add to selection |
| 33 | `-box` | `-Box` | box subtract |
| 34 | `mvsz` | `MvSZ` | move slab and zoom |
| 35 | `clik` | `Clik` | simple click (fires click-ready callback) |
| 36,37,38 | `dgrt`,`dgmv`,`dgmz` | `RotD`,`MovD`,`MvDZ` | drag rotate/move/moveZ |
| 39,40,41 | `roto`,`movo`,`mvoz` | `RotO`,`MovO`,`MvOZ` | rotate/move object |
| 42 | `mvfz` | `MvFZ` | move fragment Z |
| 43 | `mvaz` | `MvAZ` | move atom Z |
| 44 | `drgm` | `DrgM` | drag molecule |
| 45,46,47 | `rotv`,`movv`,`mvvz` | `RotV`,`MovV`,`MvVZ` | rotate/move view (TTT/movie) |
| 48 | *(internal)* | — | `cButModePotentialClick` |
| 49 | `drgo` | `DrgO` | drag object |
| 50,51 | `imsz`,`imvz` | `IMSZ`,`IMvZ` | inverted slab-zoom / transZ |
| 52 | `box` | ` Box ` | box set selection |
| 53 | `irtz` | `IRtZ` | inverted rotate Z |
| 54,55,56 | `rotl`,`movl`,`mvzl` | `RotL`,`MovL`,`MvzL` | edit light direction / position / Z |

Wheel-only pseudo-modes 101–108 (`ButMode.h:106-113`) are produced by `ButModeTranslate`, never
stored.

---

## 5. `cmd.button()` bit packing

`packages/engine/modules/pymol/controlling.py:799-868`. Names are resolved through the abbreviation matcher
`Shortcut` (`packages/engine/modules/pymol/shortcut.py:20-203`), so `cmd.button('l','shft','+Box')` works.

```python
button_code = {left:0, middle:1, right:2, wheel:3,
               double_left:4, double_middle:5, double_right:6,
               single_left:7, single_middle:8, single_right:9}      # :30-41
but_mod_code = {none:0, shft:1, ctrl:2, ctsh:3, alt:4, alsh:5, ctal:6, ctas:7}  # :44-53

if button_num < 3:                       # L/M/R
    but_code = b + 3*m           if m < 4 else b + 68 + 3*(m-4)     # :851-855
elif button_num < 4:                     # wheel
    but_code = 12 + m            if m < 4 else 64 + m - 4           # :856-860
else:                                    # single/double
    but_code = (16 + button_num - 4) + m*6                          # :862
_cmd.button(_COb, but_code, act_code)                               # :864
```

**Backend contract for the mouse-config panel:** `cmd.button(button, modifier, action)` is the
only supported write path. There is **no** getter — `ButModeGet` exists in C
(`packages/engine/layer1/ButMode.h:225`) and is **NOT exposed to Python** (grepped). The panel
therefore mirrors the Python-side `mode_dict` to render the matrix
(`packages/viewport/src/input/modes.ts`); no C++ accessor was added. See §17.

## 6. Mouse rings and mode cycling

`ring_dict` (`controlling.py:127-164`):

| ring | cycles through |
|---|---|
| `maestro` | three_button_maestro |
| `three_button` (legacy) / `three_button_viewing` | viewing → editing |
| `three_button_editing` | editing → viewing |
| `two_button` (legacy) / `two_button_viewing` | two_button_viewing → two_button_selecting |
| `two_button_editing` | editing → viewing → selecting |
| `three_button_motions` | motions → viewing |
| `three_button_all_modes` | editing → motions → viewing → lights |
| `one_button` | one_button_viewing |

* `cmd.config_mouse(ring)` sets `button_mode=0`, replaces the global `mouse_ring`, then calls
  `cmd.mouse()` (`controlling.py:168-202`).
* `cmd.mouse(action)` (`controlling.py:609-686`): `'forward'`/`'backward'` step `button_mode`
  modulo ring length; `'select_forward'`/`'select_backward'` step `mouse_selection_mode` in 0..6
  (`:637-646`); a bare mode name jumps directly; **negative `button_mode` encodes a mode outside the
  ring** as `-1 - index_into(mode_name_list)` (`:657-660`, `:670`). After applying, it sets
  `button_mode_name` and calls `cmd.button()` for every row, then `unpick()` for non-editing modes
  or `deselect()` for editing modes (`:679-680`), and finally `refresh_wizard()` (`:685`).
* `cmd.edit_mode(active)` (`controlling.py:688-717`) is the legacy toggle between
  `*_viewing` and `*_editing` for the current family. Used by the Builder panel
  (`packages/engine/modules/pmg_qt/builder.py:1341`).
* Display names (`controlling.py:206-217`): `3-Button Lights`, `3-Button Maestro`,
  `3-Button Viewing`, `3-Button Editing`, `3-Button Motions`, `2-Button Viewing`,
  `2-Btn. Selecting`, `2-Button Editing`, `2-Button Lights`, `1-Button Viewing`.
* `mode_name_list` order is load-bearing (`controlling.py:219-232`) — the comment says
  "okay to append new mode name, but don't insert: order & position matter", because
  `button_mode` persists negatively by index.
* The in-viewport ring cycler: clicking the ButMode block cycles modes; clicking its top two lines
  cycles the *selection* level instead; right-click opens the `mouse_config` menu; Shift or
  right-button or scroll-backward reverses direction (`packages/engine/layer1/ButMode.cpp:147-188`).
* `mouse_config` menu items (`packages/engine/modules/pymol/menu.py:82-101`): 3-Button Motions / 3-Button Editing /
  3-Button Viewing / 3-Button Lights / 3-Button All Modes / (sep) / 2-Button Editing /
  2-Button Viewing / 2-Button Lights.

---

## 7. Complete button × modifier → action matrices

Transcribed verbatim from `packages/engine/modules/pymol/controlling.py:234-548`. `w` = wheel.
Rows not listed for a mode are unbound (`-1`) unless PyMOL's default table filled them.

### 7.1 `three_button_viewing` (`:320-348`) — the default UX
| | none | shft | ctrl | ctsh | alt |
|---|---|---|---|---|---|
| L | `rota` | `+Box` | `move` | `Sele` | `move` |
| M | `move` | `-Box` | `pkat` | `orig` | `none` |
| R | `movz` | `clip` | `pk1` | `clip` | `none` |
| Wheel | `slab` | `movs` | `mvsz` | `movz` | — |

Single: L=`+/-`, M=`cent`, R=`menu`; Single L+alt=`cent`; Single L+ctrl=`cent`.
Double: L=`menu`, M=`none`, R=`pkat`.

### 7.2 `three_button_editing` (`:349-377`)
| | none | shft | ctrl | ctsh | alt |
|---|---|---|---|---|---|
| L | `rota` | `roto` | `torf` | `mova` | `move` |
| M | `move` | `movo` | `+/-` | `orig` | `none` |
| R | `movz` | `mvoz` | `pktb` | `clip` | `none` |
| Wheel | `slab` | `movs` | `mvsz` | `movz` | — |

Single: L=`pkat`, M=`cent`, R=`menu`; L+alt=`cent`; L+ctrl=`cent`.
Double: L=`torf`, M=`drgm`, R=`pktb`.

### 7.3 `three_button_motions` (`:378-407`)
| | none | shft | ctrl | ctsh | alt |
|---|---|---|---|---|---|
| L | `rota` | `rotv` | `torf` | `mova` | `move` |
| M | `move` | `movv` | `pkat` | `orig` | `none` |
| R | `movz` | `mvvz` | `pktb` | `clip` | `none` |
| Wheel | `slab` | `movs` | `mvsz` | `movz` | — |

Single: L=`pkat`, M=`cent`, R=`menu`; L+alt=`cent`; L+ctrl=`cent`.
Double: L=`menu` **then overwritten by** `torf` (duplicate row at `:398-399` — the later
`cmd.button` call wins; this is a latent bug worth preserving-or-fixing deliberately),
M=`drgm`, R=`pktb`.

### 7.4 `three_button_lights` (`:235-262`)
| | none | shft | ctrl | ctsh | alt |
|---|---|---|---|---|---|
| L | `rota` | `rotl` | `none` | `none` | `none` |
| M | `move` | `movl` | `none` | `none` | `none` |
| R | `movz` | `mvzl` | `none` | `none` | `none` |
| Wheel | `slab` | `movs` | `mvsz` | `movz` | — |

Single: L=`none`, M=`cent`, R=`menu`; L+alt=`cent`. Double: all `none`.
Which light is edited is `edit_light` clamped 1..9 (`packages/engine/layer1/SceneMouse.cpp:1973-1974`, `:1998-1999`).

### 7.5 `three_button_maestro` (`:291-319`)
| | none | shft | ctrl | ctsh | alt |
|---|---|---|---|---|---|
| L | `box` | `+Box` | `+/-` | `Sele` | `move` |
| M | `rota` | `-Box` | `irtz` | `orig` | `none` |
| R | `move` | `clip` | `pk1` | `clip` | `none` |
| Wheel | `imvz` | `movs` | `none` | `slab` | — |

Single: L=`sele`, M=`cent`, R=`menu`; L+shft=`+/-`; L+alt=`cent`.
Double: L=`menu`, M=`none`, R=`pkat`. (`w,ctrl = none` deliberately, "disable since ctrl-middle is irtz".)

### 7.6 `two_button_viewing` (`:408-435`)
| | none | shft | ctrl | ctsh | alt |
|---|---|---|---|---|---|
| L | `rota` | `pk1` | `move` | `sele` | `move` |
| M | `none` | `none` | `none` | `none` | `none` |
| R | `movz` | `clip` | `pkat` | `cent` | `none` |
| Wheel | `none` | `none` | `none` | `none` | — |

Single: L=`pkat`, M=`none`, R=`menu`; L+alt=`cent`. Double: L=`menu`, M=`none`, R=`cent`.

### 7.7 `two_button_selecting` (`:436-463`)
| | none | shft | ctrl | ctsh | alt |
|---|---|---|---|---|---|
| L | `rota` | `+Box` | `+/-` | `sele` | `move` |
| M | `none` | `none` | `none` | `none` | `none` |
| R | `movz` | `-Box` | `pkat` | `cent` | `none` |
| Wheel | `none` ×4 | | | | |

Single: L=`+/-`, R=`menu`; L+alt=`cent`. Double: L=`menu` (declared twice, `:456-457`),
M=`none`, R=`cent`.

### 7.8 `two_button_editing` (`:464-491`)
| | none | shft | ctrl | ctsh | alt |
|---|---|---|---|---|---|
| L | `rota` | `pkat` | `torf` | `rotf` | `move` |
| M | `none` ×5 | | | | |
| R | `movz` | `clip` | `pktb` | `movf` | `none` |
| Wheel | `none` ×4 | | | | |

Single: L=`pkat`, M=`none`, R=`menu`; L+alt=`cent`. Double: L=`menu`, M=`none`, R=`cent`.

### 7.9 `two_button_lights` (`:263-290`) — reachable only via `cmd.mouse('two_button_lights')`
| | none | shft | ctrl | ctsh | alt |
|---|---|---|---|---|---|
| L | `rota` | `rotl` | `movl` | `none` | `none` |
| M | `none` | `none` | `none` | `none` | `none` |
| R | `movz` | `mvzl` | `none` | `cent` | `none` |
| Wheel | `none` ×4 | | | | |

Single: M=`none`, R=`menu`, L+alt=`cent`. Double: L=`menu`, R=`cent`.

### 7.10 `one_button_viewing` (`:492-534`) — the only mode using alsh/ctal/ctas
| | none | shft | ctrl | ctsh | alt | alsh | ctal | ctas |
|---|---|---|---|---|---|---|---|---|
| L | `rota` | `+Box` | `movZ` | `clip` | `move` | `-Box` | `none` | `none` |
| M/R | `none` everywhere | | | | | | | |
| Wheel | `slab` | `movs` | `mvsz` | `movz` | — | — | — | — |

Single L: none=`+/-`, shft=`none`, ctrl=`menu`, ctsh=`pkat`, alt=`cent`, alsh/ctal/ctas=`none`.
Double: L=`menu`, M/R=`none`.

### 7.11 `default` (`:535-547`) — mirrors `PyMOL_SetDefaultMouse` (`packages/engine/layer5/PyMOL.cpp:2979-3021`)
L=`rota`, M=`move`, R=`movz`; R+shft=`clip`; M+ctsh=`orig`;
wheel none/shft/ctrl/ctsh = `slab`/`movs`/`mvsz`/`movz`; double-middle=`none`; single-middle=`cent`.
In C, every unfilled single/double slot is `cButModeSimpleClick` and every unfilled L/M/R+mod slot is
`cButModePotentialClick` (`packages/engine/layer5/PyMOL.cpp:3011-3019`), and `FB_Scene` results feedback is masked off
to suppress click spam (`:3021`).

---

## 8. Click / double-click / single-click semantics

All in `packages/engine/layer1/SceneMouse.cpp`:

* **Double-click** (`SceneClickCheckDoubleClick`, `:146-170`): within `cDoubleTime = 0.35 s`
  (`:26`), within 10 px in both axes, same button → button is promoted to `P_GLUT_DOUBLE_*`.
  Only attempted if the corresponding single slot is bound **or** no modifier is held (`:151`).
* **"Possible single click"** (`:664-674`): set when `ButModeCheckPossibleSingleClick` or no
  modifier; also forced on if `button_mode_name` starts with `'1'` (i.e. `1-Button Viewing`).
* **On release** (`SceneRelease`, `:1141-1172`): if the press→release gap exceeds
  `0.25 s + ApproxRenderTime`, the single click is cancelled; otherwise state becomes 2 with a
  `SingleClickDelay = 0.15 s`. If the matching *double* slot is `cButModeNone`, the delay is
  zeroed so the single click fires immediately (`:1165-1170`).
* **Deferred single-click dispatch** (`packages/engine/layer1/Scene.cpp:2439-2450`): in `SceneIdle`, once
  `now - LastReleaseTime > SingleClickDelay`, `SceneDeferClickWhen(..., LastButton + P_GLUT_SINGLE_LEFT, ...)`
  synthesises the single-click event.
* **Drag cancels single click**: >0.15 s since press (`SceneDrag`, `:1222-1227`) or >4 px total
  movement (`:2028-2035`).
* **Threshold for torsion picks**: `cButModePkTorBnd` sets `I->Threshold = 3` px so the first
  3 px of movement do not drag (`:909-913`, consumed at `:1461-1466` and `:1514-1519`).

## 9. Drag semantics per action (`SceneDrag`, `packages/engine/layer1/SceneMouse.cpp:1205-2036`)

* **`rota` (RotXYZ)** — virtual trackball, `scale = 0.45 * min(W,H)` (`:1312-1315`).
  `virtual_trackball` (default 1, `packages/engine/layer1/SettingInfo.h:414`) selects three formulations
  (`:1774-1804`): `2` = twist-aware relative-to-origin, `1` = classic centre-relative,
  `0` = pure delta. Rotation magnitude is `mouse_scale * 2 * 180 * asin(|n1×n2|)/π`, clamped by
  `mouse_limit * |v1-v2| / scale` (`:1840-1850`). `mouse_scale` default 1.3, `mouse_limit` default
  100 (`SettingInfo.h:296-297`).
* **`rotz`/`irtz`** — in-plane twist `omega` about `axis2` (`:1861-1865`, `:1886-1904`); `irtz`
  uses `(LastX - x)/2` degrees about Z.
* **`move` (TransXY)** — `v2 = (dx, dy) * SceneGetExactScreenVertexScale(origin)` (`:1725-1760`),
  then `roving_origin` / `roving_detail` follow-ups.
* **`movz` (TransZ)** — `factor = mouse_z_scale * dy/400 * max(5, -pos.z)`; sign flips unless
  `legacy_mouse_zoom` (`:1905-1924`). Defaults: `mouse_z_scale` 1.0 (`SettingInfo.h:719`),
  `legacy_mouse_zoom` 0 (`:542`).
* **`clip`/`clpn`/`clpf`** — near/far shifted by `dx/10`, `dy/10` (`:1925-1957`).
* **`rotl`/`movl`/`mvzl`** — mutate the `light`/`light2`… setting vector by `0.01 * d`
  (`:1958-2022`).
* **Object/fragment/view drags** (`roto/movo/mvoz/rotv/movv/mvvz/rotf/movf/mvfz/torf/mova/mvaz/pktb`)
  route to `EditorDrag`, `ObjectMoleculeMoveAtom`, `ObjectMoleculeMoveAtomLabel`, `ObjectSliceDrag`,
  `ObjectDistMoveLabel` (`:1499-1724`). Label picks (`cPickableLabel`) are re-targeted to the atom
  for object/fragment/view modes (`:945-962`).
* **Gadget drag** (color ramps etc.) is handled under `cButModePickAtom` (`:1319-1367`) and again in
  the object branch (`:1522-1564`); it uses `RenderContext::UnitWindow` vs `Camera` scaling.
* **Movie/TTT capture**: `movie_auto_store` grabs the object and sets `ReinterpolateFlag`
  (`:828-843`, `:964-980`, `:1603-1614`, `:1189-1201`).
* `SceneNoteMouseInteraction` (`:37-43`) aborts view animation and optionally restarts the frame
  timer (`mouse_restart_movie_delay`, default 0, `SettingInfo.h:499`).

## 10. Wheel / scroll

* Qt: `wheelEvent` → `get_wheel_button` → 3 (up) or 4 (down), then **a synthetic down+up pair** is
  sent (`pymol_gl_widget.py:190-196`).
* `get_wheel_delta` (`keymapping.py:100-122`) ignores horizontal scroll **unless** Shift is held, in
  which case horizontal delta is used (emulating shift-wheel = horizontal).
* Wheel actions are direction-resolved in `ButModeTranslate` (§4.2) and executed in `SceneClick`
  (`SceneMouse.cpp:717-802`): slab scale ±`0.2*mouse_wheel_scale`, slab move ±`0.1*mouse_wheel_scale`,
  zoom ±`0.1*mouse_wheel_scale * (front+back)/2`. `mouse_wheel_scale` default 0.5
  (`SettingInfo.h:623`).
* Wheel over the ButMode block cycles mouse modes backwards (`ButMode.cpp:159-160`).

## 11. Pinch-zoom gesture

`pymol_gl_widget.py:122` grabs `Qt.GestureType.PinchGesture`; `gestureEvent` (`:138-168`):

* On `GestureStarted`, snapshot `pinch_start_z = cmd.get_view()[11]`.
* `RotationAngleChanged` → `cmd.turn('z', last - current)`.
* `ScaleFactorChanged` → `z = pinch_start_z / totalScaleFactor`; `view[11] = z`;
  `view[15] -= delta; view[16] -= delta` (front/back clip follow the origin); `cmd.set_view(view)`.
  There is an explicit workaround for `totalScaleFactor == 1.0` (QTBUG-48138).

This is the **only** camera path in the Qt front-end that goes through `set_view` rather than
`_button/_drag` — a useful precedent for the browser (see §16).

## 12. Box (rubber-band) selection

* Entered from `cButModeRectAdd/RectSub/Rect/SeleAddBox/SeleSetBox/SeleSubBox` →
  `SceneLoopClick` (`SceneMouse.cpp:45-57`), which seeds `LoopRect`, sets `LoopFlag`, calls
  `OrthoSetLoopRect(G, true, rect)` (`packages/engine/layer1/Ortho.cpp:253-260`) and `OrthoGrab`.
* Drag updates `right/bottom` only (`:59-66`) — so the rect is drawn from the anchor.
* Release normalises the rect, calls `ExecutiveSelectRect(G, rect, mode)` (`:68-91`).
* `ExecutiveSelectRect` (`packages/engine/layer3/Executive.cpp:7432-7586`) runs `SceneMultipick`
  (`packages/engine/layer1/ScenePicking.cpp:332`) over the rect, creates `_tmp_rect_sele`, then set/add/subtract
  against the active selection using the current `sel_mode_kw`, honouring `log_box_selections`.
* The rubber band itself is drawn by Ortho, so in the web port it becomes a React/CSS overlay —
  but the *result* must still come from the backend `SceneMultipick`.

## 13. Picking and selection semantics

### 13.1 Picking mechanism
`SceneDoXYPick(G, x, y, click_side)` (`packages/engine/layer1/ScenePicking.cpp:17-38`) does a **GPU color-index
render pass** and `PyMOLReadPixels(...)` (`:149`) to identify `(object, atom index, bond index,
state)`. `pick32bit` controls bit depth (`:56`); `pick_shading` forces flat shading (`:234`, `:272`).
`pick_surface` (default 0, `SettingInfo.h:812`) and `pickable` (default 1, `:134`) gate what can be
hit; `cmd.mask()/unmask()` (`controlling.py:870-925`) flip `pickable` per atom.

**This is the single hardest constraint for the web port**: picking is authoritative on the backend
and requires the backend's own GL context. See §17.

### 13.2 Selection levels (`mouse_selection_mode`)
`SceneGetSeleModeKeyword` (`packages/engine/layer1/Scene.cpp:504-510`) maps the setting to a selection-expansion
keyword (`Scene.cpp:460-468`):

| value | keyword | label shown |
|---|---|---|
| 0 | *(empty)* | `Atoms` |
| 1 (default) | `byresi` | `Residues` |
| 2 | `bychain` | `Chains` |
| 3 | `bysegi` | `Segments` |
| 4 | `byobject` | `Objects` |
| 5 | `bymol` | `Molecules` |
| 6 | `bca.` | `C-alphas` |

Labels at `packages/engine/layer1/ButMode.cpp:370-392`; default 1 at `SettingInfo.h:449`. Cycled by
`cmd.mouse('select_forward'/'select_backward')` (`controlling.py:637-646`), which wraps 0..6.
When the current single-left action **is** `pkat`, the ButMode block shows
`Picking Atoms (and Joints)` instead and clicking it does not cycle the level
(`ButMode.cpp:163-173`, `:363-366`).

### 13.3 What each pick action does
`SceneClickObject` (`SceneMouse.cpp:233-373`) and `SceneClickTransformObject` (`:375-480`):

* `sele` (`SeleSet`) / `+/-` (`SeleToggle`) — build `sel_mode_kw(obj\`index)` and
  `SelectorCreate` into the active selection name from `ExecutiveGetActiveSeleName`;
  toggle uses the symmetric-difference expression at `:99-101`. Honours `auto_hide_selections` and
  `auto_show_selections` (`:131-134`), then `WizardDoSelect` (`:135`).
* `pk1` (`PickAtom1`) — creates `pk1`, activates the editor with `pkresi=1`, logs
  `cmd.edit("...",pkresi=1)` (`:404-429`).
* `pkat` (`PickAtom`) — multi-atom editor picking `pk1..pk4` via `EditorGetNextMultiatom`;
  clicking an already-picked atom **un**picks it (`:430-471`).
* `pkbd`/`pktb` — `SceneClickPickBond` (`:490-549`) creates `pk1`+`pk2` from the bond, logs
  `cmd.edit("a","b")`, and for `pktb` prepares a torsion drag.
* `orig` — `ExecutiveOrigin` at the atom (`:282-310`); `cent` — `ExecutiveCenter` (`:311-330`).
* `drgm` / `drgo` — issue `cmd.drag("bymol (...)")` / `cmd.drag("byobject (...)")`
  (`:264-281`); `cmd.drag` is defined at `packages/engine/modules/pymol/editing.py:1020`.
* `menu` — `MenuActivate2Arg(..., "pick_sele", name, name)` if the atom is in the active selection,
  else `"pick_menu"` (`:382-403`); with nothing picked, `MenuActivate3fv(..., "main_menu", LastClickVertex)`
  (`:883-887`). Menu contents live in `packages/engine/modules/pymol/menu.py:1682` (`main_menu`), `:1709`
  (`pick_sele`).
* `clik` (`SimpleClick`) — no selection side-effects; calls
  `PyMOL_SetClickReady(name, index, button, mod, x, ScreenHeight-(y+1), pos, state+1, bond)`
  (`:1044-1058`) or with an empty name if nothing was hit (`:586-589`).
  **Note the second y-flip here** — the click callback reports y in *top-left* origin.
* Nothing picked with `sele` clears the active selection to `none`; with `+/-` it disables it
  (`SceneClickPickNothing`, `:558-597`). Note the missing `break` at `:573` — `SeleSet` falls
  through into `SeleToggle`, so a miss both clears *and* disables. Preserve or fix deliberately.

### 13.4 Click-ready callback (for `clik`)
`PyMOL_GetClickString` (`packages/engine/layer5/PyMOL.cpp:2624-2725`) returns a newline-separated key=value blob:
`type=none|object|object:molecule|object:cgo`, `object=`, `index=` (1-based), `bond=`, `rank=`,
`id=`, `segi=`, `chain=`, `resn=`, `resi=`, `name=`, `alt=`, `click=` (one of
`left|single_left|single_middle|single_right|double_left|double_middle|double_right`),
`mod_keys=` (space-separated ` ctrl` ` alt` ` shift`), `x=`, `y=`.
Exposed as `pymol._cmd.get_click_string(_COb, reset)` (`packages/engine/layer4/Cmd.cpp:1420-1436`, table entry
`:6451`). **There is no `cmd.get_click_string` Python wrapper** — I grepped `packages/engine/modules/` and found
none. The bridge must call `_cmd.get_click_string` directly or a wrapper must be added.

### 13.5 Selection indicator (the pink dots)
Rendered by `ExecutiveRenderSelectionsFromTargets` (`packages/engine/layer3/Executive.cpp:8462-8567`) as a point CGO.
Default colour `(1.0, 0.2, 0.6)` unless `rec->sele_color` is set (`:8310-8313`). Width comes from
`ExecutiveGetAdjustedSelectionWidth` (`:8362-8380`): `selection_width_scale * |stick_radius| /
SceneGetScreenVertexScale`, clamped to `[selection_width, selection_width_max]`. Defaults:
`selection_width` 3.0, `selection_width_max` 10.0, `selection_width_scale` 2.0
(`SettingInfo.h:164, 489, 490`); `selection_round_points` 0 (`:559`),
`selection_overlay` 1.0 (`:165`), `selection_visible_only` 0 (`:570`, used at `Executive.cpp:8466`).
Multi-pass outline widths at `Executive.cpp:8419-8450`.
`auto_indicate_flags` creates the `indicate` selection (`Executive.cpp:9442-9445`, name at `:128`).

The indicator is geometry PyMOL already computes, so it crosses the wire as a point buffer
rather than being re-derived client-side from atom coordinates.

## 14. Non-scene mouse targets inside the viewport

* **Movie control bar** (`packages/engine/layer1/Control.cpp`): 9 buttons, `NButton = 9` (`:62`), hit-test
  `which_button` (`:243-255`). Release actions (`:288-385`):
  0 rewind, 1 back, 2 stop (also clears `sculpting` and `rock`), 3 play/pause (Ctrl → rewind+play),
  4 forward, 5 ending (Ctrl → middle), 6 toggle `seq_view` (label "S"), 7 toggle `rock`,
  8 `full_screen` (label "F"). Buttons 3/6/7 render in an "active" colour when engaged (`:645-649`).
  The left nub drags the internal GUI width (`:257-286`), and a double-click within 0.35 s collapses/
  restores it (`:448-469`).
* **Scene buttons / scrollbar** inside the scene block (`SceneMouse.cpp:179-223`, `:642-709`,
  `:1233-1303`): left = activate scene with interpolation, middle = rapid browse (Ctrl disables
  animation), right = drag-to-reorder or `scene_menu` pop-up; dragging reorders via
  `cmd.scene_order([...])`.
* **Wizard block** (`packages/engine/layer1/Wizard.cpp:483+`) — buttons and pop-ups.
* **Object/Executive panel, Sequence viewer, Movie panel** — other areas' docs; they all arrive
  through the same `OrthoButton` path today.
* **Spaceball / SDOF** (`packages/engine/layer1/Control.cpp:83-216`, `packages/engine/layer4/Cmd.cpp:3665` `_sdof`): 6-DOF queue,
  `SDOF_NORMAL_MODE`/`SDOF_DRAG_MODE`/`SDOF_CLIP_MODE` toggled by device buttons 1/2. Out of scope
  for a browser client unless WebHID is used — recommend explicitly dropping.
* **Drag & drop of files onto the canvas** (`pymol_gl_widget.py:256-270`) — accepts URLs, local files
  go to `gui.load_dialog(url)`. Maps to HTML5 drag&drop + upload/path handoff.

---

## 15. Keyboard

### 15.1 Qt → PyMOL key codes (`packages/engine/modules/pmg_qt/keymapping.py`)

`keyMap` (`:10-17`): Escape→27, Tab→9, Backspace→8, Return/Enter→13, Delete→127.
`specialMap` (`:19-41`): Left→100, Up→101, Right→102, Down→103, PageUp→104, PageDown→105,
Home→106, End→107, Insert→108, F1..F12→1..12. These match
`packages/engine/modules/pymol/internal.py:398-421` (`special_key_codes`) and `packages/engine/layer0/os_gl_glut_pretend.h:14-21`.

`keyPressEventToPyMOLButtonArgs` (`:61-97`) returns `(k, state, 0, 0, mod)`:
* special key → `state = -2`;
* otherwise `state = -1`, `k = keyMap.get(key, -1)`, falling back to `ord(ev.text())`;
* if still -1 and Ctrl held → `k = key - 64` (Qt key codes are uppercase ASCII, so Ctrl-A→1);
* if Alt held → `k = key` (the raw uppercase key code);
* out-of-range (`k > 255 or k < 0`) is dropped.

Sent from the *window* (`packages/engine/modules/pmg_qt/pymol_qt_gui.py:50-54`), i.e. keyboard is global to the app,
not canvas-scoped; the GL widget only takes focus on click (`pymol_gl_widget.py:111`,
`Qt.FocusPolicy.ClickFocus`). Tab is intercepted by an event filter so it does completion instead of
focus-change (`pymol_qt_gui.py:440-455`).

### 15.2 C-side key routing

`PyMOL_Key` (`packages/engine/layer5/PyMOL.cpp:2353-2359`): try `WizardDoKey` (`packages/engine/layer1/Wizard.cpp:328-342`, calls
the wizard's `do_key(k,x,y,mod)` in Python), else `OrthoKey`.

`PyMOL_Special` (`:2361-2395`): try `WizardDoSpecial` (`Wizard.cpp:462-477`); Up/Down always go to
`OrthoSpecial` (command-line history); Left/Right go there only if `OrthoArrowsGrabbed`
(i.e. there is text on the command line **and** text is visible — `Ortho.cpp:403-407`, `:392-397`);
otherwise it runs `_special k,x,y,mod` through the parser (`:2385-2392`).

`OrthoKey` (`packages/engine/layer1/Ortho.cpp:841-1032`) is the internal command line:
* `mod == 4` (Alt) → `cmd._alt(chr(k))`, except `'@'` which is re-dispatched with no modifier
  ("option G produces '@' on some non-US keyboards", `:803-812`).
* `mod == 3` (Ctrl+Shift) → `cmd._ctsh(chr(k+64))` (`:854-855`).
* Printable (`k > 32 && k != 127`) → inserted into the command line (`add_normal_char`, `:821-838`).
* `32` space — if the line is empty: `presentation` on → `cmd.scene('','next')`, Shift → `rewind;mplay`;
  otherwise `mtoggle`, Shift → `rewind;mplay` (`:860-878`).
* `127` delete, `8` backspace — line editing (`:879-903`).
* `1` Ctrl-A → beginning of line if arrows grabbed, else `_ctrl('A')` (`:911-916`).
* `5` Ctrl-E → end of line, else `_ctrl('E')` (`:905-910`).
* `4` Ctrl-D → delete char / filename completion query (`:917-936`).
* `9` Tab → `PComplete` tab-completion (Ctrl-I with Ctrl held → `_ctrl('I')`) (`:937-958`).
* `27` Escape → in `presentation` mode quits; else dismisses splash, else toggles `text`
  (Shift → toggles `overlay`) (`:959-978`).
* `13` Enter → parse current line; if empty and a movie panel exists:
  `mview toggle` / Shift `mview toggle_interp` / Ctrl `mview toggle,freeze=1` /
  Ctrl+Shift `mview toggle_interp,object=same`; in `presentation` mode `mtoggle` (`:979-1001`).
* `11` Ctrl-K → truncate line (`:1002-1013`).
* `22` Ctrl-V → `cmd.paste()` if the line has text, else `_ctrl('V')` (`:1014-1025`).
* default → `cmd._ctrl(chr(k+64))` (`:1026-1028`).

`OrthoSpecial` (`:322-389`) implements Up/Down = history recall, Left/Right = cursor movement
within the internal command line.

### 15.3 Python key dispatch (`packages/engine/modules/pymol/internal.py`)

`modifier_keys = ['', 'SHFT', 'CTRL', 'CTSH', 'ALT']` (`:390-396`) — indexed by the numeric modifier
mask, so a mask of 4 (Alt) yields `'ALT'`. `_special(k,x,y,m)` (`:447-480`) converts the code to a
name, prefixes the modifier, tries `_invoke_key`, then falls back to **scene names** and
**view names** (including prefix auto-completion) before printing "No key mapping and no scene or
view for '%s'". `_ctrl`/`_alt`/`_ctsh` (`:488-511`) invoke `CTRL-x` / `ALT-X` (upper-cased) /
`CTSH-x`. `_cmmd` (`:500-507`) dispatches macOS ⌘ bindings out of `cmd.cmmd`.

`_invoke_key(key)` (`:426-445`) looks up `cmd.key_mappings[key]`; the value is either a command
string (run via `cmd.do`) or a `(fn, args, kwargs)` triple.

`cmd.set_key(key, fn|string, arg, kw)` (`controlling.py:719-797`) — also usable as a decorator
(`:766-770`). Validation: modifier must be in `internal.modifier_keys`; multi-char names must be in
`internal.special_key_names` (lower-cased unless it starts with `F`); single letters require a
modifier and cannot use `SHFT` alone. Docstring lists the redefinable set as:
`F1..F12`, `left, right, pgup, pgdn, home, insert`, `CTRL-A..CTRL-Z`, `ALT-0..ALT-9`, `ALT-A..ALT-Z`.

### 15.4 Full default key binding table

Verbatim from `packages/engine/modules/pymol/shortcut_dict.py:10-136` (key → command, description):

**Navigation / movie / scene**
| Key | Command | Description |
|---|---|---|
| `left` | `_ backward` | previous movie frame |
| `right` | `_ forward` | next movie frame |
| `pgup` | `scene action=previous` | previous scene |
| `pgdn` | `scene action=next` | last scene |
| `home` | `zoom animate=-1` | zoom all |
| `end` | `mtoggle` | play/pause movie |
| `insert` | `rock` | |
| `SHFT-left` | `backward` | |
| `SHFT-right` | `forward` | |
| `SHFT-pgup` | `scene action=previous` | previous scene |
| `SHFT-pgdn` | `scene action=next` | next scene |
| `SHFT-home` | `rewind` | |
| `SHFT-end` | `ending` | |
| `SHFT-insert` | `rock` | |
| `CTRL-left` | `backward` | |
| `CTRL-right` | `forward` | |
| `CTRL-pgup` | `_ scene new, insert_before` | insert scene before current |
| `CTRL-pgdn` | `_ scene new, insert_after` | insert scene after current |
| `CTRL-home` | `zoom animate=-1` | zoom all |
| `CTRL-end` | `scene new, store` | store new scene |
| `CTRL-insert` | `scene auto, store` | store auto scene |
| `ALT-left` | `backward` | |
| `ALT-right` | `forward` | |
| `ALT-pgup` | `rewind` | |
| `ALT-pgdn` | `ending` | |
| `ALT-home` | `zoom animate=-1` | zoom all |
| `ALT-end` | `ending` | |
| `ALT-insert` | `rock` | |
| `CTSH-left` | `backward` | |
| `CTSH-right` | `forward` | |
| `CTSH-pgup` | `scene new, insert_before` | insert scene before current |
| `CTSH-pgdn` | `scene new, insert_after` | insert scene after current |
| `CTSH-home` | `zoom animate=-1` | zoom all |
| `CTSH-end` | `mtoggle` | |
| `CTSH-insert` | `rock` | |

**CTRL-letter**
| Key | Command | Description |
|---|---|---|
| `CTRL-A` | `select sele, all, 1` | select all |
| `CTRL-C` | `editing_ring copy` | copy |
| `CTRL-F` | `wizard find` | find |
| `CTRL-H` | `help edit_keys` | help |
| `CTRL-I` | `editing_ring invert` | invert selection |
| `CTRL-L` | `util.ligand_zoom()` | zoom next ligand |
| `CTRL-T` | `bond;unpick` | create bond |
| `CTRL-V` | `editing_ring paste` | paste |
| `CTRL-X` | `editing_ring cut` | cut |
| `CTRL-Y` | `redo` | |
| `CTRL-Z` | `undo` | |

**ALT-digit — fragment attach** (all `editor.attach_fragment('pk1', …)`)
`ALT-1` formamide 5,0 (amide N→C) · `ALT-2` formamide 4,0 (amide C→N) · `ALT-3` sulfone 3,1 ·
`ALT-4` cyclobutane 4,0 · `ALT-5` cyclopentane 5,0 · `ALT-6` cyclohexane 7,0 ·
`ALT-7` cycloheptane 8,0 · `ALT-8` cyclopentadiene 5,0 · `ALT-9` benzene 6,0 ·
`ALT-0` formaldehyde 2,0. (`shortcut_dict.py:50-59`)

**ALT-letter — amino-acid / fragment attach** (`shortcut_dict.py:60-82`)
`A` ala · `B` ace · `C` cys · `D` asp · `E` glu · `F` phe · `G` gly · `H` his · `I` ile ·
`J` acetylene (fragment 2,0) · `K` lys · `L` leu · `M` met · `N` asn · `P` pro · `Q` gln · `R` arg ·
`S` ser · `T` thr · `V` val · `W` trp · `Y` tyr · `Z` nme. (No `ALT-O`, `ALT-U`, `ALT-X`.)

**CTSH-letter — chemical editing** (`shortcut_dict.py:90-111`)
`A` redo · `B` `replace Br,1,1` · `C` `replace C,4,4` · `D` `remove_picked` · `E` `invert` ·
`F` `replace F,1,1` · `G` `replace H,1,1` · `I` `replace I,1,1` · `J` `alter pk1,formal_charge=-1.` ·
`K` `alter pk1,formal_charge=1.` · `L` `replace Cl,1,1` · `N` `replace N,4,3` · `O` `replace O,4,2` ·
`P` `replace P,4,1` · `R` `h_fill` · `S` `replace S,4,2` · `T` `bond;unpick` ·
`U` `alter pk1,formal_charge=0.` · `W` `cycle_valence` · `X` `cmd.auto_measure()` ·
`Y` `attach H,1,1` · `Z` `undo`.

**Function keys** (`shortcut_dict.py:112-135`)
For n = 1..12: `CTRL-Fn` → `scene Fn, store`, `CTSH-Fn` → `scene SHFT-Fn, store`.
Bare `F1`..`F12` and `SHFT-F1`..`SHFT-F12` are **not** in the table; they fall through
`_special` → scene/view name lookup (`internal.py:466-478`), which is exactly how the stored
scenes above are recalled.

**Clipboard ring** (`packages/engine/modules/pymol/keyboard.py:38-84`): `editing_ring` supports
`copy` / `cut` / `paste` / `invert`, using a hidden persistent object created with
`cmd.create(..., extract=…)` and restoring `auto_hide_selections` around it (`:23-30`).

### 15.5 Reserved / non-rebindable keys
`ShortcutManager.reserved_keys = ('CTRL-S','CTRL-E','CTRL-O','CTRL-M','up','down')`
(`packages/engine/modules/pymol/shortcut_manager.py:21`). Note `CTRL-M` is ASCII 13 (Enter) and `CTRL-E`/`CTRL-A`
are consumed by line editing when the command line has content (`Ortho.cpp:905-916`).

### 15.6 Shortcut editor dialog (`packages/engine/modules/pmg_qt/shortcut_menu_gui.py`)
Widgets to reproduce in React:
* Filter `QLineEdit` with placeholder "Filter", live regex filtering (`:79-84`).
* Refresh `QPushButton` with `refresh.svg` icon, tooltip "Refresh the table to reflect any external
  changes" (`:86-94`).
* `QTableView` with 3 columns: **Key**, **Command (click to edit)**, **Description** (`:164-165`).
  Key is read-only; editing a command calls `cmd.set_key` and marks the row "user defined"
  (`:394-415`). Deleted rows show `"Deleted"` (`:174-177`, `:225-243`).
* Buttons: **Create New** (`:107-114`), **Delete Selected** (`:116-123`), **Reset Selected**
  (`:125-131`), **Reset All** (`:133-138`), **Save** (`:140-145`).
* Sub-dialogs loaded from `.ui` forms: `create_shortcut` (fields `keyEdit`, `commandEdit`,
  `createButton`, `helpButton`), `help_shortcut`, `change_confirm` (`confirmButton`,
  `cancelButton`, `doNotShowCheckBox`) — `:61-63`, `:277-286`, `:347-355`.
* Key capture: `eventFilter` on `keyEdit` converts a live key event to PyMOL notation
  (`keyevent_to_string` `:300-314`, `process_keyevent_string` `:316-342`), mapping
  Control/Meta→`CTRL`, Control+Shift→`CTSH`, Alt→`ALT`, Shift→`SHFT`, and renaming
  `PageUp→pgup, PageDown→pgdn, Home→home, Insert→insert, Up→up, Down→down, Left→left,
  Right→right, End→end` (`:32-41`). Reserved keys are silently rejected (`:288-290`).
* Persistence: `~/.pymol/shortcuts_save.json` (`packages/engine/modules/pymol/save_shortcut.py:6`,
  `save_shortcuts` `:18-35`, `load_shortcuts_dict` `:37-54`). Loaded at startup
  (`pymol_qt_gui.py:418-419`).
* Reconciliation logic to port as-is: `ShortcutManager.check_saved_dict` / `check_key_mappings` /
  `reset_all_default` / `create_new_shortcut` (`shortcut_manager.py:23-139`).

---

## 16. Precise browser-event mapping specification

### 16.1 Pointer events on the canvas

Use **Pointer Events** (not MouseEvent) so pen/touch unify, and `setPointerCapture` for grab.

| Browser | PyMOL call |
|---|---|
| `pointerdown` (mouse) | `_button(BTN[e.button], 0, X(e), Y(e), MOD(e))` |
| `pointerup` / `pointercancel` | `_button(BTN[e.button], 1, X(e), Y(e), MOD(e))` |
| `pointermove` | `_drag(X(e), Y(e), MOD(e))` |
| `wheel` (deltaY<0) | `_button(3, 0, …)` then `_button(3, 1, …)` |
| `wheel` (deltaY>0) | `_button(4, 0, …)` then `_button(4, 1, …)` |
| `wheel` with shift & \|deltaX\|>\|deltaY\| | use `deltaX` sign (mirrors `keymapping.py:116-121`) |
| `contextmenu` | `preventDefault()` — right-button semantics are PyMOL's |
| `gesturestart/change/end` (Safari) or 2-pointer pinch synth | see §16.4 |

with
```ts
const BTN = {0: 0, 1: 1, 2: 2};             // pymol_gl_widget.py:45-49
const X = e => Math.round((e.clientX - rect.left) * dpr);
const Y = e => Math.round((rect.height - (e.clientY - rect.top)) * dpr);   // pymol_gl_widget.py:173-174
const MOD = e => (e.shiftKey?1:0) | ((e.ctrlKey||e.metaKey)?2:0) | (e.altKey?4:0); // keymapping.py:49-57
```

Notes:
* **Mouse tracking is always on** in Qt (`setMouseTracking(True)`, `pymol_gl_widget.py:108`) —
  passive moves are delivered even with no button down. `OrthoDrag` no-ops unless something is
  grabbed/clicked (`Ortho.cpp:2588-2594`), so sending every `pointermove` is *correct* but wasteful.
  So passive moves are sent only between pointerdown and pointerup, coalesced to the **latest**
  position per budget window and flushed before any button event
  (`packages/viewport/src/input/coalescer.ts`). The coalescer runs off a clock rather than
  `requestAnimationFrame`, because rAF stops dead in a hidden or occluded tab and an rAF-driven
  flush turns a whole drag into one jump at `pointerup`.
* `e.button` for pointerup is the released button; ensure a synthetic `_button(b,1,…)` is sent on
  `pointercancel`, `blur`, and `visibilitychange` so the backend never stays in a dragging state.
* `e.getCoalescedEvents()` should be **ignored** — PyMOL's drag math is incremental
  (`LastX/LastY`), so replaying coalesced points would multiply rotation speed.
* Middle-click must `preventDefault()` on `auxclick`/`pointerdown` to stop autoscroll.
* Do **not** synthesise double/single clicks in the browser: PyMOL does that itself in
  `SceneClickCheckDoubleClick` / `SceneIdle` (§8). Browser `dblclick` must be suppressed.

### 16.2 Keyboard

Attach at the document/app level (matching `pymol_qt_gui.py:50`), but gate: if focus is inside a
React text input, do not forward. Translation:

```
specials = {ArrowLeft:100, ArrowUp:101, ArrowRight:102, ArrowDown:103,
            PageUp:104, PageDown:105, Home:106, End:107, Insert:108,
            F1:1 … F12:12}                            // keymapping.py:19-41
if (specials[e.key] !== undefined)  send _button(specials[e.key], -2, 0, 0, MOD)
else {
  k = {Escape:27, Tab:9, Backspace:8, Enter:13, Delete:127}[e.key]
      ?? (e.key.length === 1 ? e.key.codePointAt(0) : -1)      // keymapping.py:78-83
  if (k === -1 && (MOD & 2)) k = e.keyCode - 64                // keymapping.py:85-86  (Ctrl-A → 1)
  if (k !== -1 && (MOD & 4)) k = e.keyCode                     // keymapping.py:88-89  (Alt → raw code)
  if (k >= 0 && k <= 255) send _button(k, -1, 0, 0, MOD)
}
```

Gotchas:
* `e.keyCode` is deprecated but is the only cheap source of the *uppercase-ASCII* code that
  `keymapping.py` relies on for Ctrl/Alt. Prefer deriving it from `e.code` (`KeyA` → 65,
  `Digit0` → 48) to stay standards-compliant, and document the equivalence.
* Ctrl+letter and Alt+letter are browser/OS shortcuts (Ctrl-T new tab, Ctrl-W close, Alt-F menu…).
  `preventDefault()` recovers most but **not** Ctrl-W/Ctrl-T/Ctrl-N in most browsers. PyMOL binds
  `CTRL-T` (`bond;unpick`) and `CTRL-F` (`wizard find`), so those collide. The bindings stay as
  upstream defines them and are rebindable from the shortcut editor
  (`apps/web/src/features/shortcuts/`); the browser wins where `preventDefault()` cannot.
* macOS: Qt folds Meta (⌘) into the CTRL bit (`keymapping.py:51-52`), so `e.metaKey` → bit 2.
  The separate `_cmmd` path (`internal.py:500-507`, `Ortho.cpp:775-786`) is only reachable from the
  native macOS GLUT build and is not ported.
* Send on `keydown` only (Qt sends on `keyPressEvent`); ignore `keyup`. Ignore auto-repeat only if a
  binding is expensive — Qt does not ignore it.
* `Tab` must be `preventDefault()`-ed so it reaches the PyMOL command line for completion
  (mirrors `pymol_qt_gui.py:449-455`).

### 16.3 devicePixelRatio changes

Listen to `matchMedia(\`(resolution: ${dpr}dppx)\`)` change + `ResizeObserver`. On change:
1. resize the WebGL drawing buffer,
2. `cmd.set('display_scale_factor', Math.round(dpr))` (`pymol_gl_widget.py:222`) — note it must be
   an **integer** or the C side warns and forces 1 (`packages/engine/layer1/Setting.cpp:2953-2958`),
3. `_reshape(wDevice, hDevice, true)`.
Wrap in try/catch: the Qt code notes `set` fails "with modal draw (mpng ..., modal=1)"
(`pymol_gl_widget.py:223-225`).

### 16.4 Pinch / trackpad zoom

Two sources: Safari `gesturestart/gesturechange/gestureend`, and Chrome/Firefox which report
trackpad pinch as `wheel` with `ctrlKey === true`. **This collides with PyMOL's Ctrl+wheel = `mvsz`.**
Handled by mirroring `gestureEvent` (`pymol_gl_widget.py:138-168`):
* `wheel` with `e.ctrlKey` and no physical Ctrl pressed (track `keydown/keyup` state) → treat as
  pinch: on first event snapshot `view[11]` from `cmd.get_view()`, then
  `z = startZ / totalScale; view[11] = z; view[15] -= (z - old); view[16] -= (z - old);
  cmd.set_view(view)`.
* Two-finger rotate → `cmd.turn('z', deltaDegrees)`.
* If a real Ctrl key is down, fall through to `_button(3|4, …)` so `mvsz` still works.

---

## 17. Why the backend stays authoritative for the camera

Everything authoritative depends on the backend view matrix, which is why the browser never owns
it:

* **Picking** is a GPU colour-pick pass in the backend's own GL context
  (`packages/engine/layer1/ScenePicking.cpp:17-38`, `PyMOLReadPixels` at `:149`) — it renders *with
  the backend's camera*. If the browser camera differs by one frame, clicks hit the wrong atom.
* **Box select** uses `SceneMultipick` over a screen rect (`Executive.cpp:7432-7438`) — same
  problem, amplified.
* **Drag/edit math** uses `SceneGetExactScreenVertexScale` and
  `MatrixInvTransformC44fAs33f3f(I->m_view.rotMatrix(), ...)` on the backend
  (`SceneMouse.cpp:1490-1491`, `:1596-1597`, `:1729`) — atom positions computed from mouse deltas
  depend on the backend's rotation matrix and zoom.
* **Clip planes, slab, roving detail, `mouse_z_scale`, `virtual_trackball`** are backend settings
  applied inside `SceneDrag`; reimplementing them client-side means forking numerically sensitive
  code (`SceneMouse.cpp:1762-2026`).
* **Scenes, `mview`, `zoom animate=-1`, rock, movie playback** all animate the backend camera
  (`ControlRock`, `Control.cpp:415-439`; `SceneIdle` sweep, `Scene.cpp:2410-2427`), so the browser
  has to follow the backend regardless.

### The two input paths that came out of this

**Mode P (backend has a GL context).** Every pointer event is forwarded verbatim as
`_button`/`_drag` and `SceneClick`/`SceneDrag`/`SceneRelease` decide what it means. Bit-exact for
all 57 actions, zero reimplementation, picking always consistent.
`packages/viewport/src/input/mouse.ts` is that path; it only ever *coalesces* consecutive drags
(safe: `SceneDrag` reads the current position against the press position) and never reorders them.

**Mode G (backend started `--no-gl`).** Raw input is accepted and silently never applied:
`CScene::click/drag/release` only call `OrthoDefer` (`Scene.cpp:4113`, `:4129`, `:4146`), and the
queue is drained by `ExecutiveDrawNow`, which runs only while `PyMOL_GetIdleAndReady` is true —
and that only advances while `DrawnFlag` is set, which only `PyMOL_Draw` sets. Measured: a 20-step
drag moved `get_view()[2]` by exactly 0. So on a GL-free backend the client drives the session the
way a script does — `turn`, `move`, `clip`, `rotate`, `translate`, `torsion`, `select` — which take
effect immediately because they are ordinary API calls rather than queued scene events.
`packages/viewport/src/input/camera.ts` is that path.

Both paths resolve the gesture through the same ButMode arithmetic, redone on **every** drag
sample with the modifier that sample carried, exactly as `SceneDrag` does
(`packages/engine/layer1/SceneMouse.cpp:1308`, `mode = ButModeTranslate(G, I->Button, mod)`), so
releasing Shift mid-drag changes the action mid-drag.

### `ButModeGet`/`ButModeTranslate` are mirrored, not exposed

They exist in C (`packages/engine/layer1/ButMode.h:225`, `packages/engine/layer1/ButMode.cpp:603`)
and are **NOT PRESENT** in Python — only the write path `cmd.button`
(`packages/engine/modules/pymol/controlling.py:799-868`) exists. No C++ accessor was added. The
authoritative binding table is the Python one (`controlling.mode_dict`, `mouse_ring`,
`mode_name_dict`), applied via `cmd.button()`, with the current mode read from
`cmd.get('button_mode')` / `cmd.get('button_mode_name')`. `packages/viewport/src/input/butmode.ts`
mirrors it, expands it into the same 80 slots the C core keeps, and resolves it with the same
arithmetic; `butmode.test.ts` and `modes.test.ts` diff every table against the real
`controlling.py` and `ButMode.cpp` in the tree, so the mirror cannot drift silently.

`camera.ts` does not guess at the actions whose C implementation has no Python equivalent —
`DrgM`/`DrgO`/`DgRt` (they consume `EditorDrag` state the client cannot see), the light actions,
and the click-only actions (`PkAt`, `Menu`, `Cent`, `Orig`, ...) which belong to the press, not
the drag. Those are counted as unsupported and issue nothing. Gains are approximate — degrees per
pixel and Angstroms per pixel are constants there, where PyMOL derives them from a virtual
trackball and `SceneGetExactScreenVertexScale`. The *action* a gesture maps to is exact; how far
one pixel takes you is not.

## 18. The bridge surface for this area

| Direction | Message | Backing |
|---|---|---|
| C→S | `{t:'input',kind:'button'}` (button, state, x, y, mod) | `_cmd._button` (`Cmd.cpp:3626`) |
| C→S | `{t:'input',kind:'drag'}` (x, y, mod) | `_cmd._drag` (`Cmd.cpp:3646`) |
| C→S | `{t:'input',kind:'reshape'}` (w, h, force) | `_cmd._reshape` (`Cmd.cpp:3569`) |
| C→S | `cmd.set('display_scale_factor', n)` | `Setting.cpp:2946` |
| C→S | `cmd.button/mouse/config_mouse/edit_mode/set_key/mask/unmask` | `controlling.py` |
| C→S | `cmd.set_view/get_view/turn/move` | `viewing.py:734/634/1300/352` |
| S→C | view + redisplay tick | `pymol.getRedisplay()` (`pymol2/__init__.py:37`), `PyMOL_Idle` |
| S→C | `button_mode_name`, `mouse_selection_mode` | plain settings, delivered on the settings topic |

Three things stay client-side because upstream has no Python surface for them:

* the **mouse config table** — mirrored in `packages/viewport/src/input/butmode.ts` (§17),
  not fetched;
* the **loop rect** for box select — `OrthoSetLoopRect` (`Ortho.cpp:253`) is only drawn
  internally, so the browser draws its own from the same press/current coordinates
  (`apps/web/src/features/console/OrthoLoopRect.tsx`);
* `get_click_string` — `_cmd.get_click_string` (`Cmd.cpp:1420`) has no `cmd.*` wrapper upstream,
  so the `clik` / SimpleClick pathway is reached through the raw `_cmd` entry point.

---

## 19. Constraints this area lives under

1. **Picking requires the backend's GL context.** `SceneDoXYPick` renders a pick pass and calls
   `PyMOLReadPixels` (`ScenePicking.cpp:149`), so every pick costs a full render. A GL-less bridge
   cannot pick at all — `packages/viewport/src/picking/route.ts` chooses between the backend pass
   and a client-side ray on that basis.
2. **Camera divergence breaks picking silently** — the wrong atom is selected with no error. This
   is the reason §17 keeps the view authoritative on the backend.
3. **Browser keyboard hijacking.** `CTRL-T`, `CTRL-F` and `CTRL-W`-adjacent defaults collide with
   the browser and some cannot be `preventDefault()`-ed.
4. **Middle-click and right-click** need `preventDefault` on `auxclick`/`contextmenu`; some Linux
   browsers still paste on middle-click.
5. **Ctrl+wheel is trackpad pinch** in Chrome/Firefox, colliding with PyMOL's Ctrl+wheel = `mvsz`
   (§16.4).
6. **The button table can drift.** The client mirrors `mode_dict` (§17); a plugin calling
   `cmd.button` directly changes `ButMode`'s real state without changing the mirror. The mirror
   tests pin it against the source, but they cannot see runtime writes.
7. **DPR/y-flip off-by-one.** Qt flips using the *logical* height before scaling
   (`pymol_gl_widget.py:174`); a naive `(h_device - y_device)` differs on fractional DPR and
   mis-picks edge pixels.
8. **Latent upstream bugs** a faithful port inherits: duplicate `double_left` row in
   `three_button_motions` (`controlling.py:398-399`), duplicate row in `two_button_selecting`
   (`:456-457`), missing `break` in `SceneClickPickNothing` (`SceneMouse.cpp:573`), double release
   dispatch in `OrthoButton` (`Ortho.cpp:2543-2556`), `ButModeSet(cButModeMiddleCtSh)` written twice
   in `PyMOL_SetDefaultMouse` (`PyMOL.cpp:3005` — the source itself comments "SET TWICE?!?").
9. **SDOF / spaceball** (`Control.cpp:83-216`, `_sdof`) has no browser equivalent short of WebHID
   and is not ported.
10. **Deferred execution ordering.** All scene input is queued through `OrthoDefer`; a transport
    that reorders or drops messages corrupts drag state, so input rides one strictly ordered
    connection with no parallel channels.
11. **Timing-based semantics** (0.35 s double-click, 0.25 s single-click window, 0.15 s delay) are
    measured on the backend against `UtilGetSeconds`, so transport jitter inflates the measured
    press-to-release gap. The client stamps `when` from the event itself, not from send time
    (`packages/viewport/src/input/coords.ts`), and the bridge passes that through.
