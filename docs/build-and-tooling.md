---
title: "Building the engine, and the toolchain"
description: "Two halves. The first is how the PyMOL engine in packages/engine/ compiles — upstream's build, which this fork inherits unchanged and which is the part that…"
---

# Building the engine, and the toolchain

Two halves. The first is how the PyMOL engine in `packages/engine/` compiles — upstream's build,
which this fork inherits unchanged and which is the part that goes wrong. The second is the
JavaScript toolchain and CI.

The short version is `bash scripts/bootstrap.sh`; this document is what that script encodes and why
each line of it is there.

---

## 1. How the engine builds

Paths in this section are relative to `packages/engine/`.

### 1.1 There is one build path, and it is `pip`

`packages/engine/CMakeLists.txt` exists but is not a standalone build system:

```cmake
cmake_minimum_required(VERSION 3.13)
project(${TARGET_NAME})
add_library(${TARGET_NAME} SHARED ${ALL_SRC})
```

`TARGET_NAME`, `ALL_SRC`, `ALL_INC_DIR`, `ALL_DEF`, `ALL_LIB`, `ALL_LIB_DIR`, `ALL_COMP_ARGS`,
`ALL_EXT_LINK` and `SHARED_SUFFIX` are all injected by `setup.py:381-393`. Running `cmake .` by hand
produces an empty target. **The CMake path is the pip path.**

Details worth knowing: `SUFFIX` is Python's `EXT_SUFFIX`, so the output is literally
`_cmd.cpython-313-darwin.so`; `PREFIX ""`, so there is no `lib` prefix; `cxx_std_17`; on Apple,
`-undefined dynamic_lookup`, which is why the extension does not link against libpython;
`CMAKE_VERBOSE_MAKEFILE on`, which is why build logs run to thousands of lines.

### 1.2 The PEP 517 chain

```toml
# packages/engine/pyproject.toml
[build-system]
build-backend = "backend"
backend-path = ["_custom_build"]
requires = ["cmake>=3.13.3", "numpy>=2.0", "setuptools>=69.2.0"]
```

`packages/engine/_custom_build/backend.py` subclasses setuptools' `build_meta` and rewrites
`sys.argv`:

```python
if self.config_settings:
    flags = [f"--{k}={v}" for k, v in self.config_settings.items()]
    sys.argv = sys.argv[:1] + ["build_ext"] + flags + sys.argv[1:]
```

That is how `--config-settings use-msgpackc=c++11` reaches `setup.py`'s argparse; the key-to-flag
mapping is literal.

**Gotcha:** the backend exports only `build_wheel` and `build_editable`. It does not re-export
`prepare_metadata_for_build_wheel`, so pip cannot ask for metadata cheaply and **builds a whole
wheel just to read `METADATA`**, then builds it again. `cmake --build` gets invoked four times in
one `pip wheel` run. The 2nd–4th are incremental, but a cold build with a wiped `build/` pays
roughly double.

### 1.3 What `setup.py` does, in order

1. **Codegen at import time.** `create_all(generated_dir)` runs at module scope, on every
   invocation — even `--help`. `create_shadertext()` slurps `packages/engine/data/shaders/*` into a
   `const char* _shader_cache_raw[]` string table plus `#include`/`#ifdef` dependency tables;
   `create_buildinfo()` shells out to `git rev-parse HEAD` (a non-git copy prints
   `fatal: not a git repository` and produces an empty SHA — harmless). Output goes to
   `$PYMOL_BLD/generated`, default `build/generated`, i.e. inside the source tree.
2. **Option parsing** — defaults in `class options` at `setup.py:193-204`.
3. **Prefix search** — `get_prefix_path()`, then each prefix is scanned for `include`,
   `include/freetype2`, `include/libxml2`, `include/openvr`, `lib64`, `lib`.
4. **Two extensions are declared**: `pymol._cmd` (the whole engine) and `chempy.champ._champ`
   (10 C files from `contrib/champ`).
5. **`build_cmake()`** makes `build/temp.../<target>`, `os.chdir`s into it, runs `cmake &lt;srcdir>
   -D...` then `cmake --build . --config Release -j&lt;os.cpu_count()>`. Note the `chdir`: the build is
   not reentrant.
6. **Version** comes from `layer0/Version.h` by regex. Currently `3.2.0a`.

`install_pymol` is effectively dead code under pip: the launcher that actually gets installed is the
setuptools console script from `[project.scripts] pymol = "pymol:launch"`.

### 1.4 What actually gets compiled

| dir | `.c` + `.cpp` | in the default build? |
| --- | --- | --- |
| `ov/src` | 8 | yes |
| `layer0` | 40 | yes |
| `layer1` | 48 | yes |
| `layer2` | 53 | yes |
| `layer3` | 16 | yes |
| `layer4` | 3 (+ this fork's `CmdWebGeometry.cpp`) | yes |
| `layer5` | 3 | yes |
| `layerGraphics/gl` | 1 | yes |
| `contrib/uiuc/plugins/molfile_plugin/src` | 67 | yes — `--vmd-plugins` defaults on |
| `contrib/mmtf-c` | 1 | only when msgpack is enabled |
| `contrib/champ` | 10 | yes, as the separate `_champ` extension |
| `layerCTest` | 23 | only with `--testing=true` |
| `contrib/vr` | 10 | only with `--openvr=true` |
| `build/generated` | 1 (`ShaderText.cpp`) | yes |

Roughly 254 objects in a default macOS build. A **new `layer4/*.cpp` file needs no build-file
edit**: `setup.py` globs the directory and `layer4` is in `pymol_src_dirs`. That is why this fork's
geometry accessor could be added without touching `setup.py` or `CMakeLists.txt`.

### 1.5 Native dependencies

| dep | needed by | note |
| --- | --- | --- |
| `libpng` | `_PYMOL_LIBPNG` | |
| `freetype` | `_PYMOL_FREETYPE` | |
| `glew` | linked on macOS | |
| `glm` | `layer0/Bezier.h`, `layer0/TTT.h` | header-only |
| `libxml2` | COLLADA export | **keg-only in Homebrew** — its prefix must be on `PREFIX_PATH` or `libxml/parser.h` is not found and `-lxml2` does not resolve |
| `netcdf` | VMD plugins | |
| `msgpack-cxx` | `guess_msgpackc()` | its mere presence flips the build into needing `mmtf.hpp` |
| `mmtf-cpp` | `layer3/MoleculeExporter.cpp` (`#include <mmtf.hpp>`) | **header-only, not in Homebrew, not in this tree.** Vendored by the bootstrap |
| `catch2` | `layerCTest` | Homebrew ships v3, which removed the v2 umbrella header, so `--testing=true` cannot work from brew |
| `collada2gltf` | glTF export | no brew formula; glTF export raises without it |

### 1.6 The failure catalogue

1. **`fatal error: 'mmtf.hpp' file not found`.** The default is `use_msgpackc = "guess"`;
   `guess_msgpackc()` finds Homebrew's msgpack headers, returns `"c++11"`, and
   `MoleculeExporter.cpp` then wants `mmtf.hpp`, which nobody installed. **Any dev with
   `msgpack-cxx` in Homebrew hits this on the first `pip install`.** The fix is to vendor
   mmtf-cpp, which is what the bootstrap does. Do not "fix" it with `--config-settings
   use-msgpackc=no` — see item 2.
2. **`use-msgpackc=no` silently amputates MMTF *and* BCIF I/O**, which are parity rows. It is not
   an acceptable default, and `scripts/bootstrap.sh` refuses to fall back to it.
3. **`libxml2` is keg-only.** Without `$(brew --prefix)/opt/libxml2` on `PREFIX_PATH` the build
   fails on missing `libxml/parser.h`. The alternative, `--libxml=no`, drops COLLADA export.
4. **`--osx-frameworks=false` is broken in this tree.** It appends the relative path `usr/X11`,
   which never resolves. Treat it as unsupported and keep the default `True`, which links
   `-framework OpenGL`.
5. **`pymol -c script.py` exits 0 even when the script raises**, and with `-y` it can produce zero
   output and exit 0. Upstream CI's `pymol -ckqy testing/testing.py --run all` is therefore only
   weakly load-bearing. Assert on parsed output, not on exit code.
6. **Ray-traced image-diff tests are not bit-stable on darwin/arm64.** Do not gate CI on image
   tests on macOS.
7. **`pip install -e .` writes a ~10 MB `.so` into the source tree**, and upstream's `.gitignore`
   does not ignore `*.so`. This is why the bootstrap installs the engine **non-editable** and why
   it appends the build's leavings to `.git/info/exclude` (a local-only file that git never merges,
   so an upstream merge can never see it).
8. **`PYMOL_PATH` moves between install modes.** `guess_pymol_path()` resolves it to the parent of
   `modules/` when running from a source tree, and to `<site-packages>/pymol/pymol_path` under a
   wheel install; `PYMOL_DATA` and `PYMOL_SCRIPTS` derive from it. Nothing may hardcode either
   layout.
9. **Upstream's macOS CI does not test arm64** — it downloads the x86_64 Miniforge on an Apple
   Silicon runner, so upstream builds PyMOL under Rosetta. This fork's arm64 build is, as far as
   upstream CI is concerned, untested territory.

### 1.7 Build flags that matter

| flag | default | effect |
| --- | --- | --- |
| `--glut` | `False` | `True` links `-framework GLUT` and omits `_PYMOL_NO_MAIN`, enabling the legacy GLUT main loop. Keep it off — we never want an OS window. |
| `--osx-frameworks` | `True` | `-framework OpenGL` + `_PYMOL_OSX`. The `False` path is broken (§1.6.4). |
| `--use-msgpackc` | `"guess"` | `c++11` \| `c` \| `guess` \| `no`. `no` kills MMTF and BCIF. |
| `--libxml` | `True` | COLLADA export; needs the keg-only libxml2 prefix. |
| `--vmd-plugins` | `True` | 67 molfile plugins + netcdf. This is how `.xtc`, `.dcd`, `.ccp4` load. |
| `--testing` | `False` | adds `layerCTest`; needs Catch2 **v2**. |
| `--jobs` / `-j` | — | **not honoured** — `build_cmake` uses `os.cpu_count()` unconditionally. |
| `PREFIX_PATH` env | — | colon-separated header/lib search roots. |
| `PYMOL_BLD` env | `build` | relocates the generated dir. |
| `DEBUG` env | unset | `-Og -g`, `_GLIBCXX_ASSERTIONS`. |

---

## 2. `scripts/bootstrap.sh`

One command takes a clean clone with only native deps installed to a working `pnpm dev`. Seven
steps, in order:

1. **Platform and native deps.** macOS requires Homebrew and hard-fails listing whatever of
   `cmake libpng freetype glew glm netcdf msgpack-cxx libxml2` is missing. Linux probes for the
   headers and warns rather than failing. Catch2 is deliberately not required.
2. **Python venv** at `packages/bridge/.venv` (override with `--venv` or `$TENMOL_VENV`). It
   prefers an explicit, non-shimmed interpreter — a pyenv shim or a conda python changes
   `setup.py`'s prefix search — and warns if the chosen one looks conda-flavoured. Build
   requirements (`pip`, `numpy`, `setuptools`, `cmake`) are installed **before** the engine build,
   because the build runs `--no-build-isolation`.
3. **Vendor mmtf-cpp** into `packages/engine/.deps/mmtf-cpp` (override with `$TENMOL_DEPS_DIR` or
   point `$TENMOL_MMTF_INCLUDE` at an existing copy). A `--depth 1` clone of
   `rcsb/mmtf-cpp`, unpinned. It goes **out of tree** and onto `PREFIX_PATH` rather than into
   `packages/engine/include/`, which is upstream's and must stay pristine.
4. **Build the engine into the venv**, non-editable, with `--no-build-isolation --config-settings
   use-msgpackc=c++11` and `PREFIX_PATH` covering the brew prefix, the keg-only libxml2, and the
   vendored headers. On failure it tails the log and refuses to suggest `use-msgpackc=no`. It then
   removes the `pymol.egg-info` pip leaves in the upstream tree.
5. **`pip install -e packages/bridge[dev]`.** PySide6 from the engine's `[dev]` extra is
   deliberately not installed: this client replaces the Qt GUI and PySide6 is ~200 MB.
6. **`.git/info/exclude`** gains the build's leavings (`packages/engine/modules/pymol.egg-info/`,
   `packages/engine/testing/timings.tab`, `_cmd*.so`, `_champ*.so`). Local-only, never merged.
7. **`pnpm install`**, after checking node ≥ 22 and enabling pnpm through corepack if needed.

Useful flags: `--force-pymol` (rebuild even if `import pymol` works), `--skip-pymol`,
`--skip-node`, `--python PATH`, `--venv PATH`, `-q`.

**The C++ inner loop is not the bootstrap.** After editing one `packages/engine/layer*/` file:

```sh
cmake --build packages/engine/build/temp.*/_cmd
cp packages/engine/build/lib.*/pymol/_cmd.cpython-*.so \
   packages/bridge/.venv/lib/python3.13/site-packages/pymol/
```

That recompiles and relinks only what changed — a no-op build measures at 0.7 s here. Use
`bash scripts/bootstrap.sh --force-pymol` only when you want a clean rebuild.

**One upstream dependency to watch.** `setup.py` carries a `# TODO: Remove when we move to
setup-CMake` comment: upstream intends to migrate to a real CMake build, at which point the
`--config-settings` flag names this script relies on may vanish. All build invocation is kept in
this one script so the blast radius is one file.

---

## 3. `scripts/doctor.mjs`

`node scripts/doctor.mjs` (or `pnpm run doctor` — plain `pnpm doctor` hits pnpm's own builtin)
preflights everything `pnpm dev` needs and names the one thing that is missing: node, pnpm, the
workspace install, the venv, `import pymol`, an MMTF round-trip (which is how you find out the
engine was built with `use-msgpackc=no`), `import tenmol_bridge`, offscreen GL context creation, the
two dev ports, and whether the upstream tree is clean.

Its GL probe is a hard-coded CGL recipe with no other branch, so on Linux it reports no offscreen GL
even though `packages/bridge/tenmol_bridge/glcontext/egl.py` works. That is the doctor's limitation, not the
bridge's; `bash scripts/test-gl-linux.sh` is what actually exercises the Linux path.

---

## 4. The JavaScript toolchain

pnpm workspace at the **repo root**; `apps/*` and `packages/*` are the workspace globs. No
Turborepo — `pnpm -r run build` is the whole task graph.

| concern | tool | config |
| --- | --- | --- |
| package manager | pnpm, pinned by `packageManager` | `package.json`, `pnpm-workspace.yaml` |
| lint | ESLint 9 flat config + typescript-eslint | `eslint.config.js` |
| format | Prettier 3, targets named explicitly | `.prettierrc`, the `format` scripts |
| types | `tsc` per workspace project | `tsconfig.base.json` + per-package `tsconfig.json` |
| unit tests | Vitest (node and jsdom projects) | `vitest.workspace.ts` |
| e2e | `playwright-core` driving headless Chromium, with a hand-rolled runner | `apps/web/e2e/` |
| Python tests | pytest, in the bridge's venv | `packages/bridge/pyproject.toml` |

Two conventions the root tooling enforces:

* **The upstream tree is never linted or formatted.** `eslint.config.js` ignores every
  `packages/engine/` subdirectory by name, plus `docs/`, and the Prettier scripts name their targets
  explicitly instead of using `.`. A `pnpm format` must never produce a diff inside
  `packages/engine/`.
* **`tsconfig.base.json` does not set `composite`.** A package that wants project references opts
  in locally. Setting `composite` in the shared base makes any app that imports package *sources*
  through a path alias fail with `TS6307`. `declaration`, `declarationMap` and `incremental` are in
  the base, so opting in is a three-line change.

Strictness: `strict`, `noUncheckedIndexedAccess`, `noImplicitOverride`,
`noFallthroughCasesInSwitch`, `verbatimModuleSyntax`, `isolatedModules`. `noUnusedLocals` and
`noUnusedParameters` are left to ESLint as warnings so a work-in-progress file still typechecks.

The Python side is deliberately **not** a pnpm workspace project. It is driven by
`scripts/dev-bridge.sh`, which takes any `python -m tenmol_bridge` flag and finds its interpreter in
`$TENMOL_VENV`, then `packages/bridge/.venv`, then `.venv`.

---

## 5. CI

Three workflows in `.github/workflows/`:

| workflow | what it is |
| --- | --- |
| `build.yml` | **Upstream PyMOL's own CI.** Not ours; leave it byte-identical so an upstream merge never touches it. |
| `webclient-ci.yml` | This fork's gates. A Linux job runs lint, typecheck, build, the web unit suite, the parity scoreboard, the drain lint and the ownership lint; a macOS job runs `scripts/bootstrap.sh` for real and then the bridge's pytest suite. |
| `webclient-gl-linux.yml` | Offscreen GL on Linux: runs `scripts/test-gl-linux.sh` on a runner with no GPU and no X server, which is the point — Mesa's `EGL_MESA_platform_surfaceless` + llvmpipe needs neither, and gives the desktop-GL compatibility context PyMOL requires (`ScenePicking.cpp` calls `glPushMatrix`/`glShadeModel`, which do not exist in GLES). Run the same script locally in a container. |

Two things about `webclient-ci.yml` that are easy to get wrong and are commented in the file
itself: it has **no `paths-ignore`**, because two of its gates parse `docs/` — `scripts/parity.mjs`
reads `docs/feature-parity.md` and `scripts/ownership.mjs` reads
`docs/code-ownership.md` — so a docs-only commit can break CI and therefore has to run it.
And the GL-dependent steps on macOS are reported but not fatal, because GitHub's macOS runners have
no logged-in window server and hardware context creation can legitimately fail there.
