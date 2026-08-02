# @tenmol/web

The PyMOL front-end as a React application shell. This package owns the **window
layout only**: menu bar, viewport mount point, object panel, mouse-mode block, movie
controls, command line, feedback scrollback, quick buttons.

It deliberately does **not** own: the renderer, the transport, the wire types, the
popup-menu engine, the wizard panel, the sequence viewer, or any dialog.

## Layout, and where it comes from

PyMOL's window is a `QMainWindow` whose central widget is the GL viewport
(`packages/engine/modules/pmg_qt/pymol_qt_gui.py:207-208`) with an "External GUI" dock
(`:184-193`). Everything on the right -- object panel, mouse-mode block, movie
controls -- is _not Qt_: PyMOL draws it itself inside the GL viewport as 2D "Blocks",
stacked bottom-up by `OrthoLayoutPanel()` (`packages/engine/layer1/Ortho.cpp:2261-2340`). In this
client those blocks are real DOM.

```
+---------------------------------------------------------------+
| menu bar   File Edit Build Movie Display Setting Scene Mouse   |
|            Wizard Plugin Help                          [PyMOL] |
+-------------------------------------------+-------------------+
|                                           | object panel      |
|                                           |  row  A S H L C   |  <- Executive block
|          3D viewport                      |                   |     (fills)
|          (canvas mount point,             +-------------------+
|           @tenmol/viewport renders)       | wizard slot       |  <- Wizard block
|                                           +-------------------+
|                                           | mouse mode grid   |  <- ButMode block
|                                           +-------------------+
|                                           | |< < # > > >| S v F|  <- Control block
+-------------------------------------------+-------------------+
| feedback scrollback (monospace)           | Reset Zoom Orient |
|                                           | Unpick Deselect   |  <- quick buttons
| PyMOL> _____________________________      | [progress] Abort  |
+---------------------------------------------------------------+
| disconnected  ws://127.0.0.1:8765/ws            PyMOL x.y.z    |  <- web addition
+---------------------------------------------------------------+
```

Source anchors for every metric and colour are in the header comment of
`src/styles/global.css` and in each component.

## Files

| Path                              | What                                                             |
| --------------------------------- | ---------------------------------------------------------------- |
| `src/main.tsx`                    | React root                                                       |
| `src/App.tsx`                     | `<BridgeProvider><AppShell/></BridgeProvider>`                   |
| `src/bridge/protocol.ts`          | single import point; re-exports `@tenmol/protocol`               |
| `src/bridge/BridgeContext.tsx`    | the transport seam; wraps `createClient()` from `@tenmol/client` |
| `src/layout/AppShell.tsx`         | grid + splitters                                                 |
| `src/layout/MenuBar.tsx`          | menu bar, `_addmenu` item grammar                                |
| `src/layout/menuData.ts`          | truncated hand-written menu tree; to be generated                |
| `src/layout/Viewport.tsx`         | canvas mount point + reshape reporting                           |
| `src/layout/ObjectPanel.tsx`      | Executive block, A/S/H/L/C(/M)                                   |
| `src/layout/MouseModeBlock.tsx`   | ButMode block                                                    |
| `src/layout/MovieControls.tsx`    | Control block, 9 buttons                                         |
| `src/layout/FeedbackLog.tsx`      | scrollback                                                       |
| `src/layout/CommandLine.tsx`      | prompt + key handling                                            |
| `src/layout/useCommandHistory.ts` | port of `_gui.py:895-941`                                        |
| `src/layout/QuickButtons.tsx`     | External GUI button grid                                         |
| `src/layout/placeholderData.ts`   | static placeholder state                                         |

## Dependencies

`react`, `react-dom`, and the workspace packages `@tenmol/protocol` and
`@tenmol/client`. Nothing else. No Tailwind, no component library, no state manager --
state is `useState` in the component that owns it, plus one context for the bridge.

## What is real, and what is not

Real: the transport. `BridgeProvider` opens the WebSocket through `@tenmol/client`,
mirrors connection state and the server `hello` into the status strip, subscribes to
`objects`, `frame`, `settings` and `feedback`, streams `{t:'feedback'}` lines into the
scrollback, sends every command as `{t:'do'}`, and reports the viewport size as
`{t:'input',kind:'reshape'}` (re-sent on each transition to `open`, because input
frames are dropped while the socket is down).

Not real: the _contents_. The object panel, the mouse-mode grid and the frame counter
render `src/layout/placeholderData.ts`, not topic payloads. Search for `TODO(` for
every remaining seam:

- `TODO(viewport)` -- `@tenmol/viewport` takes the canvas
- `TODO(objects)` -- object panel from the `objects` topic
- `TODO(pymol-menu)` -- A/S/H/L/C popups from `packages/engine/modules/pymol/menu.py`
- `TODO(gen-menus)` -- generated menu tree
- `TODO(completion)` -- Tab completion RPC (`cmd._parser.complete`)
- `TODO(butmode)` -- real mouse-mode codes
- `TODO(dock)`, `TODO(wizard)`, `TODO(dnd)`, `TODO(color)`
