# docs

What is in this directory, and what each file is for.

| File                                                       | What it is                                                                                                                                                                                                                         |
| ---------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`architecture.md`](./architecture.md)               | **How the system works.** Process and threads, boot order, offscreen GL, the wire, the capability policy, change detection, the two render modes, picking, and what this fork changes in the engine. Start here.                   |
| [`build-and-tooling.md`](./build-and-tooling.md)           | How the PyMOL engine compiles, what `scripts/bootstrap.sh` does and why, the failure catalogue, the JS toolchain and CI.                                                                                                           |
| [`feature-parity.md`](./feature-parity.md)       | The definition of done: one checkbox per Qt-GUI affordance, each citing the upstream `file:line` it came from and the backend symbol behind it. `node scripts/parity.mjs` reads those checkboxes and scores them — 365 rows today. |
| [`code-ownership.md`](./code-ownership.md) | Machine-readable input to `scripts/ownership.mjs`, and nothing else. The historical file-ownership partition between the parallel work packages that built the client. Keep the name: the path is hardcoded in the script.         |

## Area maps

Twelve grounded inventories of the Qt/Tk front-end, each read out of the upstream source before any
of it was replaced. They are the requirements spec behind the parity inventory: when a row is
terse, the map behind it has the exact strings, the exact pixel maths, and every argument.

- [`qt-main-window.md`](./qt-main-window.md) — `pmg_qt` main window, menus, docks, toolbars
- [`internal-gui.md`](./internal-gui.md) — the OpenGL-drawn internal GUI (Ortho, object panel, popups)
- [`input-mouse-keyboard.md`](./input-mouse-keyboard.md) — mouse modes, ButMode, key bindings
- [`cmd-api-rpc.md`](./cmd-api-rpc.md) — the `cmd` API surface and how to call it over a wire
- [`geometry-extraction.md`](./geometry-extraction.md) — getting renderable geometry out of the engine
- [`settings-colors.md`](./settings-colors.md) — settings tree, setting updates, color/ramp machinery
- [`movies-scenes-states.md`](./movies-scenes-states.md) — movie panel, scenes, states, frames
- [`dialogs-volume-properties-scenes.md`](./dialogs-volume-properties-scenes.md) — modal dialogs, volume panel, property editor
- [`builder.md`](./builder.md) — the molecular builder / editor
- [`wizards.md`](./wizards.md) — the wizard framework and every bundled wizard
- [`file-io.md`](./file-io.md) — load/save/export filters, recent files, file dialogs
- [`build-and-tooling.md`](./build-and-tooling.md) — doubles as the twelfth map

## `spikes/`

Executed experiments, with the numbers they produced. The design decisions in
`architecture.md` cite these, and source comments cite them by number — they are the evidence,
so they are kept as written rather than updated.

## `screenshots/`

Captured viewport output, referenced from the specs that produced it.

## Elsewhere in the repo

Each package documents its own internals; those READMEs are more detailed than anything here.

|                               |                                                        |
| ----------------------------- | ------------------------------------------------------ |
| `packages/bridge/README.md`   | the Python bridge: threads, the pump, dispatch, policy |
| `packages/protocol/README.md` | the wire contract, frame by frame                      |
| `packages/stores/README.md`   | client state                                           |
| `packages/viewport/README.md` | the canvas and both render modes                       |
| `apps/web/README.md`          | the app shell and window layout                        |
| `apps/web/e2e/README.md`      | the end-to-end suite and how to run one spec           |
