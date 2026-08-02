# Build & Tooling — PyMOL (`tenmol` fork) → pnpm monorepo web client

> Area owner doc. Everything in part 1–3 was **executed and verified** on this machine
> (darwin/arm64, macOS 15.6.1, Apple M4 Max, 16 cores). Every claim carries a `file:line`
> or a command transcript. Part 4–7 is the proposal.
>
> Verification was done against a **copy** of the tree in the scratchpad
> (`.../scratchpad/pymol-build-probe`), so the real repo at
> `/Users/amirangel/Documents/GitHub/tenmol` was never written to.

---

## 0. TL;DR for the other agents

| Question | Answer |
|---|---|
| Does PyMOL build on darwin/arm64? | **Yes.** Clean wheel build = **15.4 s wall** (M4 Max, `-j16`), 254 objects, 9.3 MB `_cmd.cpython-313-darwin.so`, 7.5 MB wheel. |
| Does a plain `pip install .` work out of the box with Homebrew? | **No.** It fails on `'mmtf.hpp' file not found` (`packages/engine/layer3/MoleculeExporter.cpp:16`). You must either vendor `mmtf-cpp` headers or pass `--config-settings use-msgpackc=no`. |
| Do we need Qt / GLUT / a display to run the backend? | **No.** `pymol2.PyMOL()` (`packages/engine/modules/pymol2/__init__.py:79`) starts headless, loads molecules, computes surfaces and ray-traces to PNG with **zero GL context**. Verified. |
| Is there a CMake-only path? | **No.** `CMakeLists.txt` is a 31-line stub driven *entirely* by `setup.py` via `-D` variables (`setup.py:381-393`). CMake is never invoked standalone. |
| Fastest dev loop? | `pip install -e .` (26.8 s cold, ~2 s warm for Python-only edits). Python under `packages/engine/modules/` becomes live-editable; C++ needs a rebuild. |
| Where does the web client go? | New top-level `webclient/` directory. **Zero** upstream-owned files modified. |

---

## 1. How PyMOL is built from this tree

### 1.1 There is exactly ONE build path, not two

`INSTALL:50-56` documents `pip install .`. `CMakeLists.txt` exists but is **not** a
standalone build system:

```cmake
# CMakeLists.txt:1-7
cmake_minimum_required(VERSION 3.13)
project(${TARGET_NAME})
add_library(${TARGET_NAME} SHARED ${ALL_SRC})
```

`TARGET_NAME`, `ALL_SRC`, `ALL_INC_DIR`, `ALL_DEF`, `ALL_LIB`, `ALL_LIB_DIR`,
`ALL_COMP_ARGS`, `ALL_EXT_LINK`, `SHARED_SUFFIX` are all injected by
`setup.py:381-393`. Running `cmake .` by hand produces an empty target. **The CMake path
IS the pip path.** Anyone who tells you "just use CMake" is wrong for this tree.

Notable CMake details:
- `CMakeLists.txt:11` — `SUFFIX` is set to Python's `EXT_SUFFIX` (`setup.py:379`), i.e. the
  output is literally `_cmd.cpython-313-darwin.so`.
- `CMakeLists.txt:15` — `PREFIX ""` so there is no `lib` prefix.
- `CMakeLists.txt:13` — `cxx_std_17`.
- `CMakeLists.txt:22-24` — on Apple, `-undefined dynamic_lookup`. This is why the extension
  does **not** link against `libpython`; Python symbols resolve at load time.
- `CMakeLists.txt:5` — `CMAKE_VERBOSE_MAKEFILE on`, which is why build logs are enormous
  (my clean-build log was 4,512 lines).

### 1.2 The PEP 517 chain

`pyproject.toml:20-27`:

```toml
[build-system]
build-backend = "backend"
backend-path = ["_custom_build"]
requires = ["cmake>=3.13.3", "numpy>=2.0", "setuptools>=69.2.0"]
```

`packages/engine/_custom_build/backend.py:10-36` subclasses setuptools' `build_meta` and rewrites `sys.argv`:

```python
# packages/engine/_custom_build/backend.py:12-18
if self.config_settings:
    flags = [f"--{k}={v}" for k, v in self.config_settings.items()]
    sys.argv = sys.argv[:1] + ["build_ext"] + flags + sys.argv[1:]
```

**This is how `--config-settings testing=True` reaches `setup.py`'s argparse.**
Key `k` → flag mapping is literal: config-setting key `use-msgpackc` becomes
`--use-msgpackc=<v>`; key `testing` becomes `--testing=<v>`.

**Gotcha (verified):** `packages/engine/_custom_build/backend.py` only exports `build_wheel` and
`build_editable` (I introspected it: `dir(backend)` → `['_CustomBuildMetaBackend',
'_backend', 'backend_class', 'build_editable', 'build_wheel', 'sys']`). It does **not**
re-export `prepare_metadata_for_build_wheel`, `build_sdist`, or
`get_requires_for_build_wheel`. Consequence: pip cannot ask for metadata cheaply and
**falls back to building a whole wheel just to read METADATA**, then builds the wheel
again. My clean-build log shows `cmake --build` invoked **4 times** in one
`pip wheel` run (`build3.log` lines 38, 3605, 3899, 3913). The 2nd–4th are incremental
so the cost is ~1 s each, but it doubles the *cold* build if the build dir is wiped.

### 1.3 What `setup.py` actually does, in order

1. **Codegen at import time** — `setup.py:550` calls `create_all(generated_dir)` at module
   scope (i.e. it runs on *every* setup.py invocation, even `--help`).
   - `create_shadertext()` (`setup.py:97-158`) slurps `packages/engine/data/shaders/*.{gs,vs,fs,shared,tsc,tse}`
     (44 files today) and emits `build/generated/ShaderText.cpp` + `.h` as a
     `const char* _shader_cache_raw[]` string table, plus `_include_deps` /
     `_ifdef_deps` tables built from `#include` / `#ifdef` lines.
   - `create_buildinfo()` (`setup.py:161-180`) shells out to `git rev-parse HEAD` and emits
     `build/generated/PyMOLBuildInfo.h` with `_PyMOL_BUILD_DATE` and
     `_PYMOL_BUILD_GIT_SHA`. Honors `SOURCE_DATE_EPOCH`.
     When I built from a non-git copy, this printed `fatal: not a git repository` to stderr
     and produced an empty SHA — **harmless**, `Popen` doesn't raise.
   - `openw` (`setup.py:57-94`) only rewrites the file if the content changed, so codegen
     doesn't cause spurious rebuilds.
   - Output dir is `os.environ.get("PYMOL_BLD", "build") + "/generated"` (`setup.py:548`),
     i.e. **inside the source tree** by default.
   - The identical code is duplicated in the standalone `create_shadertext.py:11-19`;
     `setup.py:41-43` explains the duplication is a `pyproject.toml` workaround
     (pypa/setuptools#3939).

2. **Option parsing** — `setup.py:193-247`. Defaults in `class options` (`setup.py:193-204`).

3. **Prefix search** — `get_prefix_path()` (`setup.py:250-285`), then `setup.py:783-796`
   scans each prefix for `include`, `packages/engine/include/freetype2`, `packages/engine/include/libxml2`,
   `packages/engine/include/openvr`, `lib64`, `lib`.

4. **Two extensions declared** (`setup.py:860-878`):
   - `pymol._cmd` — the whole engine, sources from `pymol_src_dirs` (`setup.py:559-570`).
   - `chempy.champ._champ` — sources from `packages/engine/contrib/champ` (10 C files).

5. **`build_ext_pymol.build_cmake()`** (`setup.py:349-416`): `mkdir build/temp.../<target>`,
   `os.chdir` into it (`setup.py:401`), `cmake <srcdir> -D...` (`setup.py:402`),
   `cmake --build . --config Release -j<os.cpu_count()>` (`setup.py:396-404`).
   Note `os.chdir` — the build is **not** reentrant / thread-safe.

6. **`install_pymol`** (`setup.py:424-540`):
   - `--pymol-path=` / `--bundled-pmw` / `--no-launcher` install options (`setup.py:429-433`).
   - Default `PYMOL_PATH` = `<site-packages>/pymol/pymol_path` (`setup.py:441`).
   - Copies `LICENSE`, `data`, `test`, `examples` into it (`setup.py:478-486`).
     This is why the wheel is 7.5 MB and contains `pymol/pymol_path/test/dat/*.pdb`.
   - Writes a `pymol` shell launcher (`setup.py:493-540`). **On this machine the launcher
     that pip actually installed came from `[project.scripts] pymol = "pymol:launch"`
     (`pyproject.toml:46-47`)**, i.e. the setuptools console-script shim, not the hand-rolled
     `#!/bin/sh` one — because `pip install` uses the wheel installer, not `setup.py install`.
     `install_pymol` is effectively dead code in the pip flow.

7. **Version** comes from `packages/engine/layer0/Version.h` via regex (`setup.py:804-805`).
   Current: **`3.2.0a`** → wheel version `3.2.0a0`.

### 1.4 Source inventory actually compiled (counted, not guessed)

| dir | `.c`+`.cpp` | in default build? |
|---|---|---|
| `packages/engine/ov/src` | 8 | yes |
| `layer0` | 40 | yes |
| `layer1` | 48 | yes |
| `layer2` | 53 | yes |
| `layer3` | 16 | yes |
| `layer4` | 3 | yes |
| `layer5` | 3 | yes |
| `layerGraphics` | 0 (headers only) | yes (inc dir) |
| `packages/engine/layerGraphics/gl` | 1 | yes |
| `packages/engine/contrib/uiuc/plugins/molfile_plugin/src` | 67 | yes (`--vmd-plugins`, default on, `setup.py:619-629`) |
| `packages/engine/contrib/mmtf-c` | 1 | only if msgpack enabled (`setup.py:650`) |
| `packages/engine/contrib/champ` | 10 | yes, separate `_champ` ext |
| `layerCTest` | 23 | only `--testing=true` (`setup.py:657-659`) |
| `packages/engine/contrib/vr` | 10 | only `--openvr=true` (`setup.py:661-665`) |
| `build/generated` | 1 (`ShaderText.cpp`) | yes |

Default macOS build linked **254 object files** (measured: `find build -name '*.o' | wc -l`).

Header-only include dirs: `packages/engine/include/` (`packages/engine/include/pymol/*.h`, `packages/engine/include/tnt/*.h` — 36 files),
`packages/engine/contrib/pocketfft` (`setup.py:669`), `packages/engine/contrib/uiuc/plugins/include`.

---

## 2. Verified darwin/arm64 build — exact recipe, flags, timings

### 2.1 Machine state at time of writing

```
uname -m        arm64
macOS           15.6.1 (24G90), Apple M4 Max, 16 cores, 128 GB
node            v22.22.0
pnpm            9.15.4          (also: corepack, npm 10.9.4)
cmake           3.29.3          (/opt/homebrew/bin/cmake)
Xcode SDK       MacOSX26.2.sdk (clang from XcodeDefault.xctoolchain)
pymol           NOT importable  (ModuleNotFoundError: No module named 'pymol')
python3 (path)  pyenv shim 3.11.3 ; brew python3.12/3.13/3.14 present ; anaconda3 present
```

**Warning for other agents:** `python3` on PATH is a **pyenv shim** and
`/Users/amirangel/anaconda3` is also on PATH. `setup.py:288-294` (`is_conda_env()`) changes
prefix search when `sys.prefix` looks conda-ish. Always build from an explicit venv, never
from the ambient interpreter.

### 2.2 Native dependencies — audited against Homebrew

| dep | required by | brew status on this box |
|---|---|---|
| `libpng` | `setup.py:584`, `_PYMOL_LIBPNG` (`setup.py:573`) | installed, `/opt/homebrew/include/png.h` OK |
| `freetype` | `setup.py:584`, `_PYMOL_FREETYPE` (`setup.py:574`) | installed, `/opt/homebrew/include/freetype2/ft2build.h` OK |
| `glew` | `setup.py:673` (`libs += ["GLEW"]` on MAC) | installed, `/opt/homebrew/include/GL/glew.h` OK |
| `glm` | `packages/engine/layer0/Bezier.h:5`, `packages/engine/layer0/TTT.h:3-5` | installed, `/opt/homebrew/include/glm/glm.hpp` OK |
| `libxml2` | `setup.py:631-634` (COLLADA) | installed but **keg-only** → `/opt/homebrew/include/libxml2` MISSING, `/opt/homebrew/lib/libxml2.dylib` MISSING. **Must add `/opt/homebrew/opt/libxml2` to `PREFIX_PATH`** or pass `--libxml=no`. |
| `netcdf` | `setup.py:766-769` (VMD plugins) | installed, OK |
| `msgpack-cxx` | `guess_msgpackc()` (`setup.py:297-312`) | installed → `/opt/homebrew/include/msgpack/version_master.hpp` exists → **guess returns `c++11`** |
| `mmtf-cpp` | `packages/engine/layer3/MoleculeExporter.cpp:16` (`#include <mmtf.hpp>`) | **NOT PACKAGED BY BREW, NOT IN TREE.** `packages/engine/include/` contains only `pymol/` and `tnt/`. |
| `catch2` | `packages/engine/layerCTest/Test.cpp:11`, `packages/engine/layerCTest/Test.h:14` (`<catch2/catch.hpp>`) | brew ships **3.15.2** — v3 has no `catch2/catch.hpp`. **`--testing=true` cannot work from brew.** CI uses conda `catch2=2.13.3` (`build.yml:87`, `:146`). |
| `OpenGL.framework` | `setup.py:677-678` | present in SDK (deprecated since 10.9) |
| `GLUT.framework` | `setup.py:679-681`, only with `--glut=true` | present in SDK (deprecated) |
| `libomp` | `setup.py:612-614` | installed but keg-only; irrelevant — `use_openmp` defaults to **`"no"` on MAC** (`setup.py:201`) |
| `collada2gltf` binary | `packages/engine/modules/pymol/querying.py:679` | **not installed** → glTF export test errors (see 2.6) |

### 2.3 The command that works (verified, exit 0)

```bash
# one-time
/opt/homebrew/bin/python3.13 -m venv .venv
.venv/bin/pip install "numpy>=2.0" "setuptools>=69.2.0" "cmake>=3.13.3"

# build + install
PREFIX_PATH="/opt/homebrew:/opt/homebrew/opt/libxml2" \
MACOSX_DEPLOYMENT_TARGET=15.0 \
.venv/bin/pip install -v --no-build-isolation \
  --config-settings use-msgpackc=no .
```

Resulting compile line (from the log, trimmed):

```
c++ -DPYMOL_CURVE_VALIDATE -D_HAVE_LIBXML -D_PYMOL_FREETYPE -D_PYMOL_LIBPNG
    -D_PYMOL_NO_MAIN -D_PYMOL_NO_MSGPACKC -D_PYMOL_NUMPY -D_PYMOL_OSX
    -D_PYMOL_VMD_PLUGINS -D_cmd_EXPORTS
    -O3 -DNDEBUG -std=gnu++17 -arch arm64 -isysroot .../MacOSX26.2.sdk
    -mmacosx-version-min=15.0 -fPIC
    -Werror=return-type -Wunused-variable -Wno-switch -Wno-narrowing
    -Wno-char-subscripts -O3 -fno-strict-aliasing
link: -DALL_LIB=png;freetype;xml2;GLEW;netcdf;   -DALL_EXT_LINK=-framework OpenGL
```

Every one of those macros traces to a line: `_PYMOL_LIBPNG`/`_PYMOL_FREETYPE`
(`setup.py:572-576`), `_PYMOL_VMD_PLUGINS` (`setup.py:627`), `_HAVE_LIBXML`
(`setup.py:633`), `_PYMOL_NO_MSGPACKC` (`setup.py:640`), `_PYMOL_NO_MAIN`
(`setup.py:652-655`), `PYMOL_CURVE_VALIDATE` + `_PYMOL_OSX` (`setup.py:674, 683`),
`_PYMOL_NUMPY` (`setup.py:780`), `-fno-strict-aliasing` (`setup.py:800-801`),
warning set + `-O3` (`setup.py:587-597`).

### 2.4 Measured timings (`/usr/bin/time -p`, M4 Max, `-j16`)

| operation | wall | user | notes |
|---|---|---|---|
| failed build, default flags (dies at `MoleculeExporter.cpp`) | 14.3 s | 101 s | ~250 objs compiled before the error |
| **clean `pip wheel` (build/ wiped first)** | **15.4 s** | 111 s | 254 `.o`, 4× `cmake --build` |
| incremental `pip install .` after a partial build | 16.8 s | 113 s | |
| `pip install -e .` (editable, cold) | 26.8 s | 224 s | builds the ext twice (metadata fallback + editable) |
| `--config-settings testing=True` (fails on catch2) | 13.1 s | 111 s | |
| full test suite `pymol -ckq packages/engine/testing/testing.py --run all` | 9.5 s | 5.5 s | 961 tests in 7.7 s + a pytest phase |

**Calibrate expectations:** 15 s is an M4 Max number. Divide by ~1 for M4/M3 Max, expect
~40–90 s on an M1 Air, and several minutes on a GitHub `macos-latest` runner (3–4 vCPU).
`user` time is the honest metric: **~110 CPU-seconds** of compilation.

### 2.5 It runs headless — verified end-to-end

```python
import pymol2
with pymol2.PyMOL() as p:          # packages/engine/modules/pymol2/__init__.py:79
    p.cmd.fragment('ala')          # -> 10 atoms
    p.cmd.show('surface')
    p.cmd.ray(80, 60)              # 0.01 s, no GL context
    p.cmd.png('/tmp/t.png', dpi=72)  # file written
    p.cmd.get_version()            # ('3.2.0a', 3.0, 3000000, 1785418231, '', 0)
```

Startup message printed `Detected 16 CPU cores. Enabled multithreaded rendering.`

`pymol2.PyMOL.__init__` (`packages/engine/modules/pymol2/__init__.py:86-121`) calls
`_cmd._new(self, self.invocation.options)` and `PyMOL.start()`
(`packages/engine/modules/pymol2/__init__.py:129-131`) calls `_cmd._start(self._COb, self.cmd)`.
`SingletonPyMOL` (`packages/engine/modules/pymol2/__init__.py:30-76`) additionally exposes
`idle()`, `getRedisplay()`, `reshape(w,h,force)`, `draw()`, `button()`, `drag()` —
**these are the raw hooks a bridge would use if it ever needed to drive the internal
renderer**, and they are the reason a display-less process still has a scene.

**Conclusion for the architecture: the bridge does NOT need Qt, GLUT, XQuartz, or a
window server.** `--glut` stays `false`, `pmg_qt`/`pmg_tk` are never imported.

### 2.6 What commonly fails on macOS arm64 — the catalogue

Each of these I reproduced.

1. **`fatal error: 'mmtf.hpp' file not found` (`packages/engine/layer3/MoleculeExporter.cpp:16`).**
   The default flow is: `options.use_msgpackc = "guess"` (`setup.py:198`) →
   `guess_msgpackc()` (`setup.py:297-312`) finds brew's
   `/opt/homebrew/include/msgpack/version_master.hpp` with `MSGPACK_VERSION_MAJOR > 1` →
   returns `"c++11"` → `MMTF_MSGPACK_USE_CPP11` is defined and `_PYMOL_NO_MSGPACKC` is not →
   `MoleculeExporter.cpp:15` `#ifndef _PYMOL_NO_MSGPACKC` is live → needs `mmtf.hpp`, which
   nobody installed. **Any dev with `msgpack-cxx` in Homebrew hits this on the first
   `pip install .`.** Two fixes: (a) `git clone https://github.com/rcsb/mmtf-cpp && cp -R
   mmtf-cpp/include/* packages/engine/include/` exactly as CI does (`build.yml:40-43`, `:154-160`) — this
   dirties the upstream `packages/engine/include/` dir; or (b) `--config-settings use-msgpackc=no`, which
   costs you MMTF and BCIF I/O (see failure 5).

2. **`fatal error: 'catch2/catch.hpp' file not found` with `--config-settings testing=True`**
   (`packages/engine/layerCTest/Test.h:14`, `packages/engine/layerCTest/Test.cpp:11`). Homebrew only offers Catch2
   **3.15.2**; the v2 umbrella header was removed in v3. CI sidesteps this with
   conda-forge `catch2=2.13.3` (`build.yml:87`, `build.yml:146`). So on a brew-only mac the
   **C++ unit tests (`layerCTest`, 23 files) are simply not buildable** without pinning
   Catch2 v2 by hand.

3. **`libxml2` is keg-only.** Without `/opt/homebrew/opt/libxml2` in `PREFIX_PATH` you get
   missing `libxml/parser.h` / unresolved `-lxml2`. Alternative: `--libxml=no`
   (`setup.py:224-226`) which turns off COLLADA export.

4. **`--osx-frameworks=false` is broken on this tree.** `setup.py:263-264`:
   ```python
   if not options.osx_frameworks:
       paths += ["usr/X11"]
   ```
   That is a **relative** path (`usr/X11`, no leading slash) — it will never resolve to
   XQuartz's `/opt/X11` or `/usr/X11`. Additionally XQuartz is **not installed** on this
   machine (`/opt/X11` absent). Treat `--osx-frameworks=false` as unsupported; keep the
   default `True` (`setup.py:194`) which links `-framework OpenGL` (`setup.py:677-678`).

5. **Runtime test failures caused by the `use-msgpackc=no` workaround.** With the working
   build, `pymol -ckq packages/engine/testing/testing.py --run all` gave
   `Ran 961 tests in 7.669s / FAILED (failures=1, errors=5, skipped=276)`:
   - `ERROR testMMTF`, `testMMTFExportEmpty`, `testMMTFExportSele`,
     `testSave_symmetry__mmtf` — direct consequence of `_PYMOL_NO_MSGPACKC`.
   - pytest phase: `test_bcif_export` / round-trip fail for the same reason (BCIF is
     msgpack-encoded).
   - `ERROR testglTF` → `pymol.CmdException: could not find collada2gltf`
     (raised at `packages/engine/modules/pymol/querying.py:679`). CI installs a prebuilt
     `collada2gltf` tarball (`build.yml:35-38`) / conda package (`build.yml:88`, `:148`);
     there is no brew formula.
   - `FAIL test_commands (symop_py.TestBondSymOp)` →
     `AssertionError: images not equal (73)` from `assertImageEqual` at
     `packages/engine/testing/testing.py:443`. **Ray-traced image-diff tests are not bit-stable on
     darwin/arm64.** Do not gate CI on image tests for macOS.

6. **`pymol -c script.py` exits 0 even when the script raises.** I reproduced this:
   `pymol -c packages/engine/testing/testing.py --run api/test_cmd.py` printed a full
   `ModuleNotFoundError: No module named 'pytest'` traceback and still returned
   `EXIT=0`. Worse, with the `-y` flag (`exit on error`, `packages/engine/modules/pymol/invocation.py:88`)
   the same run produced **zero output and exit 0**. Upstream CI's
   `pymol -ckqy packages/engine/testing/testing.py --run all` (`build.yml:53`, `:113`, `:171`) is therefore
   only weakly load-bearing. **Our CI must assert on parsed output, not on exit code.**

7. **The test suite needs the `dev` extras** (`pyproject.toml:29-37`:
   `biopython>=1.80`, `msgpack==1.0.8`, `pillow==11.1.0`, `PySide6==6.8.1`,
   `pytest==8.2.2`, `requests==2.32.3`). `PySide6==6.8.1` is only needed for GUI tests —
   **we should not install it for the web client**; I ran the suite fine without it
   (276 skips include the GUI ones).

8. **Editable install writes a `.so` into the source tree.** After
   `pip install -e .`, `pymol.__file__` resolved to
   `<repo>/modules/pymol/__init__.py` and `_cmd.__file__` to
   `<repo>/modules/pymol/_cmd.cpython-313-darwin.so`. But `.gitignore` is only:
   ```
   *.pyc
   *.d
   generated
   build
   .vscode
   ```
   (`.gitignore:1-5`) — **`*.so` is not ignored**, so an editable install leaves an
   untracked 9.3 MB binary in `packages/engine/modules/pymol/`. Since we must not edit upstream files,
   fix this in `.git/info/exclude` (local, untracked by git) — see §5.6.

9. **`PYMOL_PATH` moves under editable installs.** `guess_pymol_path()`
   (`packages/engine/modules/pymol/__init__.py:177-204`) resolves `PYMOL_PATH` to the *parent of `packages/engine/modules/`*
   when running from the source tree, i.e. the repo root; under a wheel install it is
   `<site-packages>/pymol/pymol_path` (`setup.py:441`). `PYMOL_DATA` and `PYMOL_SCRIPTS`
   derive from it (`packages/engine/modules/pymol/__init__.py:207-211`). Anything in the bridge that
   resolves data files must not hardcode either layout.

10. **Upstream macOS CI does not test arm64.** `build.yml:133` downloads
    `Miniforge3-MacOSX-**x86_64**.sh` on a `macos-latest` runner, which since macos-14 is
    Apple Silicon. So upstream's macOS job builds an **x86_64 PyMOL under Rosetta 2**.
    `build.yml:165` also pins `MACOSX_DEPLOYMENT_TARGET=12.0`. Our arm64 build is, as far as
    this tree's CI is concerned, **untested territory** — which is exactly why I ran it.

### 2.7 Build flags that matter to us

| flag | default (`setup.py:193-204`) | effect | our setting |
|---|---|---|---|
| `--glut` | `False` | `True` links `-framework GLUT` (`setup.py:679-681`) and **omits** `_PYMOL_NO_MAIN` (`setup.py:652-655`), enabling the legacy GLUT main loop in `packages/engine/layer5/main.cpp`. | **keep `false`** — we never want an OS window |
| `--osx-frameworks` | `True` | `True` → `-framework OpenGL` + `_PYMOL_OSX`; `False` → XQuartz path, **broken** (§2.6.4) | **keep `true`** |
| `--testing` | `False` | adds `layerCTest` (23 files) + `_PYMOL_CTEST`; needs Catch2 **v2** | `false` on dev macs, `true` only in a Linux CI job |
| `--use-msgpackc` | `"guess"` | `c++11` \| `c` \| `guess` \| `no`. `no` kills MMTF **and BCIF** | `c++11` **if** we vendor mmtf-cpp; else `no` |
| `--libxml` | `True` | COLLADA export; needs keg-only libxml2 | `true` + `PREFIX_PATH` |
| `--vmd-plugins` | `True` | 67 molfile plugins + `libnetcdf` | `true` (this is how `.xtc`, `.dcd`, `.ccp4`… load) |
| `--use-openmp` | `"no"` on MAC (`setup.py:201`) | would need keg-only `libomp` | leave |
| `--use-vtkm` | `"no"` | alternative isosurfacing; raises `LookupError` if headers absent (`setup.py:743-751`) | leave |
| `--openvr` | `False` | adds `packages/engine/contrib/vr` (10 files) + `openvr_api` | leave |
| `--jobs` / `-j` | `$JOBS` or 0 | **not actually honored** — `build_cmake` uses `os.cpu_count()` unconditionally (`setup.py:398-399`); `options.jobs` is parsed and dropped | n/a |
| `DEBUG` env | unset | `-Og -g`, `_GLIBCXX_ASSERTIONS` (`setup.py:29, 578-582, 596`). Upstream Linux CI sets `DEBUG: 1` (`build.yml:50`) | off for dev speed |
| `PREFIX_PATH` env | — | colon-separated header/lib search roots (`setup.py:257-258`, `INSTALL:41-42`) | `"/opt/homebrew:/opt/homebrew/opt/libxml2"` |
| `PYMOL_BLD` env | `build` | relocates the generated dir (`setup.py:548`) | could point out-of-tree to keep the repo clean |
| `SOURCE_DATE_EPOCH` | — | reproducible `_PyMOL_BUILD_DATE` (`setup.py:178`) | set in CI |

---

## 3. Existing web-ish precedent already in the tree (read this before designing the bridge)

Do **not** reinvent from zero without looking at these; they define the naming and the
"expose `cmd` over HTTP" idioms this codebase already has:

- `packages/engine/modules/pymol/pymolhttpd.py` (529 lines). `class PymolHttpd` at line **441**,
  `__init__(self, port=8080, root=None, logging=1, wrap_natives=0, self_cmd=None,
  headers=())` at line **443**, `start()`/`stop()`/`quit()` at **493/501/510**,
  `expose(name, value)` at **513**. Request side: `_PymolHTTPRequestHandler` at line **35**,
  `pymol_apply(method)` at **209** (this is the generic `cmd.<fn>(**kwargs)` dispatcher),
  `send_json_result` at **151**, `send_json_error` at **174**, `pymol_getattr` at **126**.
  It is a `BaseHTTPRequestHandler` on a background thread — synchronous, no WebSocket.
- `packages/engine/modules/pymol/rpc.py` (474 lines) — XML-RPC server, `launch_XMLRPC(hostname='',
  port=_xmlPort, nToTry=_nPortsToTry)` at line **411**, plus ~20 `rpc*` helpers
  (`rpcLoadPDB:237`, `rpcSpheres:122`, `rpcRenderCGO:102`, `rpcGetAtomCoords:377`…).
  Enabled by the `-R` CLI flag (`packages/engine/modules/pymol/invocation.py:75`).
- `packages/engine/modules/web/javascript/pymol.js` + `json2.js`, and 16 sample apps under
  `packages/engine/modules/web/examples/`. This is 2009-era JS; treat as **reference for the JSON envelope
  shape only**.
- The `pwg` file format (`packages/engine/modules/pymol/invocation.py:103`, `get_pwg_options` at line 191)
  is PyMOL's existing "web GUI launch descriptor".

There is **no** `package.json`, `tsconfig.json`, or `.ts` file anywhere in the repo today
(verified by `find`). We are starting the JS toolchain from scratch.

---

## 4. Proposed monorepo layout

### 4.1 Guiding constraint: upstream merges must stay clean

The fork tracks `upstream = https://github.com/schrodinger/pymol-open-source.git`
(verified via `git remote -v`; `master` is 5e8bfca5, upstream branches present).
Every file we add must be a file upstream will never create, and we must modify **zero**
upstream-owned files.

Files that are upstream-owned and therefore **off limits**: `setup.py`, `pyproject.toml`,
`CMakeLists.txt`, `.gitignore`, `.github/workflows/build.yml`, `INSTALL`, `PACKAGING`,
`README*`, `.clang-format`, `.gitattributes`, everything under `layer*/`, `packages/engine/modules/`,
`packages/engine/contrib/`, `packages/engine/data/`, `packages/engine/include/`, `packages/engine/ov/`, `packages/engine/test/`, `packages/engine/testing/`, `packages/engine/examples/`, `packages/engine/_custom_build/`.

Therefore: **one new top-level directory, `webclient/`, plus one new CI workflow file.**
`webclient/` is the pnpm workspace root — not the repo root — so we don't even add a
`package.json` next to `setup.py`.

> Trade-off, stated honestly: putting the workspace root in a subdirectory means every pnpm
> command must run from `webclient/` (or via `pnpm -C webclient …`). That is the price of a
> conflict-free `git merge upstream/master`. The alternative (workspace root == repo root)
> adds `package.json`, `pnpm-workspace.yaml`, `pnpm-lock.yaml`, `node_modules/` at the top
> level; upstream will never add those names either, so conflicts are still unlikely — but
> `node_modules/` at the repo root would be scanned by `setup.py`'s globs' siblings and by
> every grep. I recommend the subdirectory.

### 4.2 The tree

```
tenmol/                                  # upstream tree — UNTOUCHED
├── setup.py  pyproject.toml  CMakeLists.txt  layer0..layer5/  packages/engine/modules/  packages/engine/data/  ...
├── docs/
│   └── webclient/                       # these planning docs
│       └── build-and-tooling.md
├── .github/workflows/
│   ├── build.yml                        # upstream's — UNTOUCHED
│   └── webclient.yml                    # NEW (ours)
└── webclient/                           # NEW — the entire web world lives here
    ├── package.json                     # workspace root manifest  (§5.2)
    ├── pnpm-workspace.yaml              # workspace globs          (§5.1)
    ├── pnpm-lock.yaml                   # committed
    ├── .npmrc
    ├── .nvmrc                           # "22"
    ├── tsconfig.base.json
    ├── eslint.config.js                 # flat config, ESLint 9
    ├── .prettierrc.json  .prettierignore
    ├── vitest.workspace.ts
    ├── .gitignore                        # scoped ignores; upstream .gitignore untouched
    │
    ├── apps/
    │   └── web/                          # @tenmol/web — Vite 6 + React 19 + TS
    │       ├── index.html
    │       ├── vite.config.ts            # dev proxy /api + /ws -> 127.0.0.1:8765
    │       ├── tsconfig.json
    │       ├── package.json
    │       └── src/
    │           ├── main.tsx  App.tsx
    │           ├── viewport/             # <Viewport/> = three.js canvas host
    │           ├── panels/               # ObjectPanel, Sequence, Console, Settings…
    │           ├── menus/                # the Qt menu bar, ported
    │           ├── dialogs/              # every Qt dialog, ported
    │           └── state/                # zustand stores mirroring PyMOL state
    │
    ├── packages/
    │   ├── protocol/                     # @tenmol/protocol
    │   │   # Single source of truth for the wire format. Zod schemas + inferred TS types
    │   │   # for: RPC envelope, cmd call/result, event stream, mesh/CGO binary headers,
    │   │   # setting ids, feedback records. A generator script diffs it against the
    │   │   # Python side so drift is caught in CI. NO runtime deps.
    │   ├── client/                       # @tenmol/client
    │   │   # Transport only: reconnecting WebSocket, binary frame demux, request/response
    │   │   # correlation, event bus, and a typed `cmd.*` proxy generated from the Python
    │   │   # signatures. Framework-agnostic (no React import).
    │   ├── react-client/                 # @tenmol/react-client
    │   │   # React bindings: <PymolProvider>, useCmd(), useSetting(), useObjects(),
    │   │   # useFeedback(), Suspense integration.
    │   ├── viewer/                       # @tenmol/viewer
    │   │   # three.js layer. Consumes ALREADY-COMPUTED geometry from the backend:
    │   │   # decoders for surface/cartoon triangle meshes and CGO buffers into
    │   │   # BufferGeometry, camera sync with PyMOL's view matrix, picking round-trip,
    │   │   # shader ports of packages/engine/data/shaders/*. MUST NOT contain any atom->representation
    │   │   # logic.
    │   ├── ui/                           # @tenmol/ui — shared React primitives/tokens
    │   └── tsconfig/                     # @tenmol/tsconfig — shared tsconfig presets
    │
    ├── services/
    │   └── packages/bridge/                       # the Python side. NOT a pnpm package.
    │       ├── pyproject.toml            # name = "tenmol-bridge"; depends on pymol
    │       ├── package.json              # thin shim so `pnpm -r` can drive it (§5.2)
    │       └── src/tenmol_bridge/
    │           ├── __main__.py           # `python -m tenmol_bridge --port 8765`
    │           ├── app.py                # ASGI app: /healthz, /ws, /api/*
    │           ├── session.py            # owns the pymol2.PyMOL() instance + its thread
    │           ├── dispatch.py           # cmd.<name>(**kwargs) — mirror of
    │           │                         #   pymolhttpd.py:209 pymol_apply
    │           ├── events.py             # feedback/state change -> event stream
    │           ├── geometry.py           # scrape computed meshes/CGO -> binary frames
    │           └── schema_export.py      # emits JSON that @tenmol/protocol validates
    │
    ├── scripts/
    │   ├── bootstrap.sh                  # brew deps + venv + editable pymol build (§5.5)
    │   ├── dev.mjs                       # boots bridge + vite together (§5.4)
    │   └── doctor.mjs                    # preflight: node/pnpm/cmake/brew/venv/pymol
    │
    └── .venv/                            # created by bootstrap.sh, git-ignored
```

### 4.3 Why the Python bridge lives at `webclient/services/bridge`

- It is *part of the web client product*, not part of PyMOL. Keeping it inside `webclient/`
  means the whole feature is one directory — trivially rebasable, trivially deletable.
- It is a **separate distribution** (`tenmol-bridge`) with its own `pyproject.toml`, so it
  never has to be merged into upstream's `pyproject.toml` (which we must not touch) and its
  dependencies (an ASGI server, msgpack, etc.) never leak into the `pymol` wheel.
- It depends on `pymol` the *installed package*, so it works identically against an editable
  dev build and against a released wheel.
- It carries a tiny `package.json` (`private: true`, no JS deps) purely so `pnpm -r run …`
  and turbo-style filtering can address it uniformly.

### 4.4 How pnpm workspaces and the Python venv coexist

They don't interact; they're coordinated by scripts, not by tooling:

1. **One venv, one location:** `webclient/.venv`, created by `scripts/bootstrap.sh` from an
   explicit interpreter (`/opt/homebrew/bin/python3.13`), never from the ambient
   `python3` (which is a pyenv shim here — §2.1).
2. **pnpm never installs Python and pip never installs JS.** `package.json` scripts shell
   out to `.venv/bin/python` by absolute-from-root path.
3. **`webclient/.gitignore`** ignores `node_modules/`, `.venv/`, `dist/`, `.vite/`,
   `*.egg-info/`, `__pycache__/`. Upstream's `.gitignore` is untouched.
4. **PyMOL's own build artifacts** (`build/`, `build/generated/`, and the editable-install
   `packages/engine/modules/pymol/_cmd*.so`) are handled by `.git/info/exclude` (§5.6) — a local file git
   never merges.
5. **Version pinning:** Node via `.nvmrc` + `engines`; pnpm via `packageManager`
   (corepack is installed on this box); Python via an exact interpreter path in
   `bootstrap.sh` + a `requirements-dev.lock` produced by `pip freeze`.

---

## 5. Exact file contents

### 5.1 `webclient/pnpm-workspace.yaml`

```yaml
packages:
  - "apps/*"
  - "packages/*"
  - "services/*"

# Keep every JS dep version decided in exactly one place.
catalog:
  react: ^19.1.0
  react-dom: ^19.1.0
  three: ^0.171.0
  zustand: ^5.0.2
  zod: ^3.24.1
  typescript: ^5.7.2
  vite: ^6.0.7
  "@vitejs/plugin-react": ^4.3.4
  vitest: ^2.1.8

onlyBuiltDependencies:
  - esbuild
```

### 5.2 `webclient/package.json` (workspace root)

```json
{
  "name": "@tenmol/root",
  "private": true,
  "type": "module",
  "packageManager": "pnpm@9.15.4",
  "engines": {
    "node": ">=22.0.0",
    "pnpm": ">=9.15.0"
  },
  "scripts": {
    "bootstrap": "bash scripts/bootstrap.sh",
    "doctor": "node scripts/doctor.mjs",

    "dev": "node scripts/dev.mjs",
    "dev:web": "pnpm --filter @tenmol/web dev",
    "dev:bridge": ".venv/bin/python -m tenmol_bridge --host 127.0.0.1 --port 8765 --reload",

    "build": "pnpm --filter @tenmol/web... build",
    "preview": "pnpm --filter @tenmol/web preview",

    "typecheck": "tsc -b --pretty false",
    "lint": "eslint . --max-warnings=0",
    "lint:fix": "eslint . --fix",
    "format": "prettier --write .",
    "format:check": "prettier --check .",

    "test": "vitest run",
    "test:watch": "vitest",
    "test:e2e": "playwright test",

    "py:build": "scripts/py-build.sh",
    "py:test": ".venv/bin/python -m pytest services/bridge/tests -q",
    "py:lint": ".venv/bin/python -m ruff check services/bridge",
    "py:format": ".venv/bin/python -m ruff format services/bridge",

    "protocol:check": ".venv/bin/python -m tenmol_bridge.schema_export > packages/protocol/generated/schema.json && git diff --exit-code packages/protocol/generated/schema.json",

    "clean": "pnpm -r exec rm -rf dist node_modules/.vite && rm -rf node_modules",
    "ci": "pnpm run format:check && pnpm run lint && pnpm run typecheck && pnpm run test && pnpm run build"
  },
  "devDependencies": {
    "@eslint/js": "^9.17.0",
    "@types/node": "^22.10.5",
    "eslint": "^9.17.0",
    "eslint-plugin-react-hooks": "^5.1.0",
    "eslint-plugin-react-refresh": "^0.4.16",
    "globals": "^15.14.0",
    "prettier": "^3.4.2",
    "typescript": "^5.7.2",
    "typescript-eslint": "^8.19.0",
    "vitest": "^2.1.8"
  }
}
```

Companion `webclient/services/bridge/package.json` (shim only, zero JS deps):

```json
{
  "name": "@tenmol/bridge",
  "private": true,
  "version": "0.0.0",
  "scripts": {
    "dev": "../../.venv/bin/python -m tenmol_bridge --host 127.0.0.1 --port 8765 --reload",
    "start": "../../.venv/bin/python -m tenmol_bridge --host 127.0.0.1 --port 8765",
    "test": "../../.venv/bin/python -m pytest tests -q",
    "lint": "../../.venv/bin/python -m ruff check src"
  }
}
```

### 5.3 `webclient/.npmrc`

```ini
# Deterministic, non-hoisted installs. Catches accidental phantom deps early.
node-linker=isolated
strict-peer-dependencies=false
auto-install-peers=true
resolution-mode=highest
prefer-workspace-packages=true
link-workspace-packages=deep
save-exact=false
engine-strict=true
```

### 5.4 `webclient/scripts/dev.mjs` — the dev orchestrator

Boots the Python bridge, waits for it to be healthy, then boots Vite; prefixes and
interleaves output; one Ctrl-C kills both.

```js
#!/usr/bin/env node
// webclient/scripts/dev.mjs
//
// Boots the whole dev stack:
//   1. preflight  — .venv exists and `import pymol` works
//   2. bridge     — .venv/bin/python -m tenmol_bridge  (owns the pymol2.PyMOL instance)
//   3. wait       — poll http://127.0.0.1:<port>/healthz
//   4. web        — pnpm --filter @tenmol/web dev  (Vite proxies /api and /ws to bridge)
// Ctrl-C (or either child dying) tears the whole group down.

import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import process from "node:process";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const REPO = path.resolve(ROOT, "..");
const VENV_PY = path.join(ROOT, ".venv", "bin", "python");

const BRIDGE_HOST = process.env.TENMOL_BRIDGE_HOST ?? "127.0.0.1";
const BRIDGE_PORT = Number(process.env.TENMOL_BRIDGE_PORT ?? 8765);
const WEB_PORT = Number(process.env.TENMOL_WEB_PORT ?? 5173);
const HEALTH_URL = `http://${BRIDGE_HOST}:${BRIDGE_PORT}/healthz`;
const HEALTH_TIMEOUT_MS = 60_000;

const C = {
  reset: "\u001b[0m",
  dim: "\u001b[2m",
  red: "\u001b[31m",
  green: "\u001b[32m",
  yellow: "\u001b[33m",
  blue: "\u001b[34m",
  magenta: "\u001b[35m",
};

const children = [];
let shuttingDown = false;

function log(msg) {
  process.stdout.write(`${C.dim}[dev]${C.reset} ${msg}\n`);
}
function fail(msg) {
  process.stderr.write(`${C.red}[dev] ${msg}${C.reset}\n`);
}

// ---------------------------------------------------------------- preflight
function preflight() {
  if (!existsSync(VENV_PY)) {
    fail(`no venv at ${VENV_PY}`);
    fail(`run:  pnpm -C ${path.relative(process.cwd(), ROOT) || "."} bootstrap`);
    process.exit(1);
  }

  const probe = spawnSync(
    VENV_PY,
    ["-c", "import pymol, pymol2, sys; sys.stdout.write(pymol.__file__)"],
    { encoding: "utf8" },
  );

  if (probe.status !== 0) {
    fail("PyMOL is not importable from the venv.");
    fail((probe.stderr || "").trim().split("\n").slice(-3).join("\n"));
    fail("");
    fail("Build it (≈15-90s depending on machine):");
    fail(`  PREFIX_PATH="/opt/homebrew:/opt/homebrew/opt/libxml2" \\`);
    fail(`  ${VENV_PY.replace(/python$/, "pip")} install -v --no-build-isolation \\`);
    fail(`    --config-settings use-msgpackc=no -e ${REPO}`);
    process.exit(1);
  }
  log(`pymol   ${C.green}ok${C.reset} ${C.dim}${probe.stdout.trim()}${C.reset}`);

  const bridge = spawnSync(VENV_PY, ["-c", "import tenmol_bridge"], { encoding: "utf8" });
  if (bridge.status !== 0) {
    fail("tenmol_bridge is not importable. Run:");
    fail(`  ${VENV_PY.replace(/python$/, "pip")} install -e ${path.join(ROOT, "services", "bridge")}`);
    process.exit(1);
  }
  log(`bridge  ${C.green}ok${C.reset}`);
}

// ------------------------------------------------------------------ spawner
function start(name, color, cmd, args, opts = {}) {
  const child = spawn(cmd, args, {
    cwd: opts.cwd ?? ROOT,
    env: { ...process.env, FORCE_COLOR: "1", ...(opts.env ?? {}) },
    stdio: ["ignore", "pipe", "pipe"],
  });

  const tag = `${color}[${name}]${C.reset} `;
  const pipe = (stream, sink) => {
    let buf = "";
    stream.setEncoding("utf8");
    stream.on("data", (chunk) => {
      buf += chunk;
      const lines = buf.split("\n");
      buf = lines.pop() ?? "";
      for (const line of lines) sink.write(tag + line + "\n");
    });
    stream.on("end", () => {
      if (buf) sink.write(tag + buf + "\n");
    });
  };
  pipe(child.stdout, process.stdout);
  pipe(child.stderr, process.stderr);

  child.on("exit", (code, signal) => {
    if (shuttingDown) return;
    fail(`${name} exited (code=${code} signal=${signal}) — shutting everything down`);
    shutdown(code ?? 1);
  });

  children.push({ name, child });
  return child;
}

// ------------------------------------------------------------------- health
async function waitForHealth(url, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let lastErr;
  while (Date.now() < deadline) {
    if (shuttingDown) return false;
    try {
      const ac = new AbortController();
      const t = setTimeout(() => ac.abort(), 1500);
      const res = await fetch(url, { signal: ac.signal });
      clearTimeout(t);
      if (res.ok) return true;
      lastErr = `HTTP ${res.status}`;
    } catch (e) {
      lastErr = e.code ?? e.name ?? String(e);
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  fail(`bridge never became healthy at ${url} (last: ${lastErr})`);
  return false;
}

// ----------------------------------------------------------------- shutdown
function shutdown(code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const { child } of children) {
    if (child.exitCode === null && child.signalCode === null) {
      try {
        child.kill("SIGTERM");
      } catch {}
    }
  }
  setTimeout(() => {
    for (const { child } of children) {
      try {
        child.kill("SIGKILL");
      } catch {}
    }
    process.exit(code);
  }, 3000).unref();
  // If everyone is already gone, leave immediately.
  const alive = children.filter((c) => c.child.exitCode === null);
  if (alive.length === 0) process.exit(code);
}

for (const sig of ["SIGINT", "SIGTERM", "SIGHUP"]) {
  process.on(sig, () => {
    log(`caught ${sig}`);
    shutdown(0);
  });
}
process.on("uncaughtException", (e) => {
  fail(String(e?.stack ?? e));
  shutdown(1);
});

// --------------------------------------------------------------------- main
preflight();

log(`starting bridge on ${BRIDGE_HOST}:${BRIDGE_PORT}`);
start("bridge", C.magenta, VENV_PY, [
  "-m",
  "tenmol_bridge",
  "--host",
  BRIDGE_HOST,
  "--port",
  String(BRIDGE_PORT),
  "--reload",
]);

if (!(await waitForHealth(HEALTH_URL, HEALTH_TIMEOUT_MS))) shutdown(1);
log(`bridge healthy at ${HEALTH_URL}`);

log(`starting vite on :${WEB_PORT}`);
start("web", C.blue, "pnpm", ["--filter", "@tenmol/web", "dev", "--port", String(WEB_PORT)], {
  env: {
    VITE_TENMOL_BRIDGE_HTTP: `http://${BRIDGE_HOST}:${BRIDGE_PORT}`,
    VITE_TENMOL_BRIDGE_WS: `ws://${BRIDGE_HOST}:${BRIDGE_PORT}/ws`,
  },
});

log(`${C.green}ready${C.reset} → http://localhost:${WEB_PORT}`);
```

Matching Vite proxy (`webclient/apps/web/vite.config.ts`):

```ts
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const BRIDGE = process.env.VITE_TENMOL_BRIDGE_HTTP ?? "http://127.0.0.1:8765";

export default defineConfig({
  plugins: [react()],
  server: {
    port: Number(process.env.TENMOL_WEB_PORT ?? 5173),
    strictPort: true,
    proxy: {
      "/api": { target: BRIDGE, changeOrigin: false },
      "/ws": { target: BRIDGE.replace(/^http/, "ws"), ws: true },
    },
  },
  build: { target: "es2022", sourcemap: true },
});
```

### 5.5 `webclient/scripts/bootstrap.sh`

```bash
#!/usr/bin/env bash
# webclient/scripts/bootstrap.sh — one-shot dev machine setup (macOS arm64 / Linux)
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WEBROOT="$(cd "$HERE/.." && pwd)"
REPO="$(cd "$WEBROOT/.." && pwd)"
VENV="$WEBROOT/.venv"

PY_BIN="${TENMOL_PYTHON:-/opt/homebrew/bin/python3.13}"

say() { printf '\033[2m[bootstrap]\033[0m %s\n' "$*"; }
die() { printf '\033[31m[bootstrap] %s\033[0m\n' "$*" >&2; exit 1; }

# --- 1. native deps -----------------------------------------------------------
if [[ "$(uname -s)" == "Darwin" ]]; then
  command -v brew >/dev/null || die "Homebrew required"
  say "installing native deps via brew"
  brew install cmake glew glm libpng freetype libxml2 netcdf msgpack-cxx

  # libxml2 is keg-only on Homebrew; setup.py needs it on PREFIX_PATH.
  export PREFIX_PATH="/opt/homebrew:/opt/homebrew/opt/libxml2"
  export MACOSX_DEPLOYMENT_TARGET="${MACOSX_DEPLOYMENT_TARGET:-15.0}"
else
  export PREFIX_PATH="${PREFIX_PATH:-/usr}"
fi

# --- 2. mmtf-cpp headers (optional; enables MMTF + BCIF I/O) ------------------
# setup.py's guess_msgpackc() will pick "c++11" whenever msgpack headers are on
# PREFIX_PATH, and packages/engine/layer3/MoleculeExporter.cpp:16 then needs <mmtf.hpp>, which no
# package manager ships. Vendor them OUT OF TREE and add to PREFIX_PATH, so the
# upstream packages/engine/include/ dir stays pristine.
MMTF_PREFIX="$WEBROOT/.deps/mmtf-cpp"
if [[ "${TENMOL_WITH_MMTF:-1}" == "1" ]]; then
  if [[ ! -f "$MMTF_PREFIX/include/mmtf.hpp" ]]; then
    say "fetching mmtf-cpp headers -> $MMTF_PREFIX"
    rm -rf "$MMTF_PREFIX" && mkdir -p "$MMTF_PREFIX"
    git clone --depth 1 https://github.com/rcsb/mmtf-cpp.git "$MMTF_PREFIX/.src"
    mv "$MMTF_PREFIX/.src/include" "$MMTF_PREFIX/include"
    rm -rf "$MMTF_PREFIX/.src"
  fi
  export PREFIX_PATH="$PREFIX_PATH:$MMTF_PREFIX"
  MSGPACK_ARG=(--config-settings use-msgpackc=c++11)
else
  say "building WITHOUT msgpack (no MMTF, no BCIF)"
  MSGPACK_ARG=(--config-settings use-msgpackc=no)
fi

# --- 3. venv ------------------------------------------------------------------
[[ -x "$PY_BIN" ]] || die "interpreter not found: $PY_BIN (set TENMOL_PYTHON)"
if [[ ! -x "$VENV/bin/python" ]]; then
  say "creating venv at $VENV using $PY_BIN"
  "$PY_BIN" -m venv "$VENV"
fi
"$VENV/bin/pip" install -q --upgrade pip
"$VENV/bin/pip" install -q "numpy>=2.0" "setuptools>=69.2.0" "cmake>=3.13.3"

# --- 4. build PyMOL, editable -------------------------------------------------
say "building pymol (editable) — expect ~15s on M-series, minutes on CI"
time "$VENV/bin/pip" install -v --no-build-isolation "${MSGPACK_ARG[@]}" -e "$REPO"

# --- 5. bridge + python dev tooling ------------------------------------------
"$VENV/bin/pip" install -e "$WEBROOT/services/bridge"
"$VENV/bin/pip" install -q pytest==8.2.2 pillow==11.1.0 msgpack==1.0.8 \
  requests==2.32.3 ruff
# NOTE: PySide6 from pyproject.toml's [dev] extra is deliberately NOT installed;
# the web client replaces the Qt GUI and PySide6 is a ~200MB dependency.

# --- 6. local-only git excludes (never touches upstream .gitignore) ----------
EXCLUDE="$REPO/.git/info/exclude"
for pat in "/webclient/node_modules/" "/webclient/.venv/" "/webclient/.deps/" \
           "/webclient/**/dist/" "packages/engine/modules/pymol/*.so" "packages/engine/modules/chempy/champ/*.so" \
           "*.egg-info/" "__pycache__/"; do
  grep -qxF "$pat" "$EXCLUDE" 2>/dev/null || echo "$pat" >> "$EXCLUDE"
done

# --- 7. node deps -------------------------------------------------------------
corepack enable >/dev/null 2>&1 || true
(cd "$WEBROOT" && pnpm install --frozen-lockfile)

say "done. run:  pnpm -C webclient dev"
```

### 5.6 `.git/info/exclude` additions (local-only; step 6 above writes these)

```
/webclient/node_modules/
/webclient/.venv/
/webclient/.deps/
/webclient/**/dist/
packages/engine/modules/pymol/*.so
packages/engine/modules/chempy/champ/*.so
*.egg-info/
__pycache__/
```

Rationale: `.gitignore:1-5` covers `*.pyc`, `*.d`, `generated`, `build`, `.vscode` but not
`*.so` or `*.egg-info`, and we must not edit it (§4.1). `.git/info/exclude` is never merged.

### 5.7 `webclient/tsconfig.base.json`

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2023", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "moduleResolution": "bundler",
    "moduleDetection": "force",
    "jsx": "react-jsx",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitOverride": true,
    "exactOptionalPropertyTypes": true,
    "verbatimModuleSyntax": true,
    "isolatedModules": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "composite": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "incremental": true,
    "noEmitOnError": true
  },
  "exclude": ["node_modules", "dist"]
}
```

---

## 6. CI

Add **`.github/workflows/webclient.yml`** — a brand-new file. Upstream's `build.yml` stays
byte-identical, so `git merge upstream/master` never touches it.

```yaml
name: webclient

on:
  push:
    paths: ["webclient/**", ".github/workflows/webclient.yml", "docs/**"]
  pull_request:
    paths: ["webclient/**", ".github/workflows/webclient.yml", "layer*/**", "packages/engine/modules/**", "setup.py"]

concurrency:
  group: webclient-${{ github.ref }}
  cancel-in-progress: true

jobs:
  # Fast, no native build: everything that only needs Node.
  js:
    runs-on: ubuntu-24.04
    steps:
      - uses: actions/checkout@v6
      - uses: pnpm/action-setup@v4
        with: { version: 9.15.4 }
      - uses: actions/setup-node@v4
        with: { node-version: 22, cache: pnpm, cache-dependency-path: webclient/pnpm-lock.yaml }
      - run: pnpm -C webclient install --frozen-lockfile
      - run: pnpm -C webclient run format:check
      - run: pnpm -C webclient run lint
      - run: pnpm -C webclient run typecheck
      - run: pnpm -C webclient run test
      - run: pnpm -C webclient run build

  # The expensive one: build PyMOL for real, then exercise the bridge.
  bridge:
    strategy:
      fail-fast: false
      matrix:
        include:
          - { os: macos-15, py: "3.13" }   # arm64 — the dev target, untested upstream
          - { os: ubuntu-24.04, py: "3.12" }
    runs-on: ${{ matrix.os }}
    steps:
      - uses: actions/checkout@v6
      - uses: actions/setup-python@v6
        with: { python-version: "${{ matrix.py }}" }

      - name: Native deps (macOS)
        if: runner.os == 'macOS'
        run: brew install cmake glew glm libpng freetype libxml2 netcdf msgpack-cxx

      - name: Native deps (Linux)
        if: runner.os == 'Linux'
        run: |
          sudo apt-get update
          sudo apt-get --no-install-recommends install -y \
            libfreetype6-dev libglew-dev libglm-dev libmsgpack-dev \
            libnetcdf-dev libpng-dev libxml2-dev

      - name: mmtf-cpp headers (out of tree)
        run: |
          git clone --depth 1 https://github.com/rcsb/mmtf-cpp.git /tmp/mmtf-cpp
          mkdir -p /tmp/deps && mv /tmp/mmtf-cpp/include /tmp/deps/include

      - name: Build PyMOL
        env:
          SOURCE_DATE_EPOCH: "0"
          MACOSX_DEPLOYMENT_TARGET: "15.0"
        run: |
          if [ "$RUNNER_OS" = "macOS" ]; then
            export PREFIX_PATH="/opt/homebrew:/opt/homebrew/opt/libxml2:/tmp/deps"
          else
            export PREFIX_PATH="/usr:/tmp/deps"
          fi
          python -m pip install --upgrade pip
          pip install "numpy>=2.0" "setuptools>=69.2.0" "cmake>=3.13.3"
          time pip install -v --no-build-isolation \
            --config-settings use-msgpackc=c++11 .

      - name: Smoke — headless PyMOL
        run: |
          python - <<'PY'
          import pymol2
          with pymol2.PyMOL() as p:
              p.cmd.fragment('ala')
              assert p.cmd.count_atoms('all') == 10, p.cmd.count_atoms('all')
              p.cmd.show('surface'); p.cmd.ray(64, 48)
              print('version', p.cmd.get_version())
          PY

      - name: Bridge tests
        run: |
          pip install -e webclient/services/bridge
          pip install pytest==8.2.2 msgpack==1.0.8 pillow==11.1.0
          pytest webclient/services/bridge/tests -q

      # Upstream's suite, kept as a regression net for the C++ we depend on.
      # NB: `pymol -c script.py` returns 0 even when the script raises (verified),
      # so we parse the output instead of trusting the exit code.
      - name: Upstream PyMOL suite (non-blocking on macOS image tests)
        continue-on-error: ${{ runner.os == 'macOS' }}
        run: |
          pip install biopython requests
          set -o pipefail
          python -m pymol -ckq packages/engine/testing/testing.py --run all 2>&1 | tee /tmp/suite.log
          grep -qE '^(OK|FAILED)' /tmp/suite.log || { echo "suite produced no verdict"; exit 1; }
          ! grep -qE '^FAILED' /tmp/suite.log

  e2e:
    needs: [js, bridge]
    runs-on: macos-15
    steps:
      - uses: actions/checkout@v6
      # …same build steps, then:
      # pnpm -C webclient exec playwright install --with-deps chromium
      # pnpm -C webclient run test:e2e   (dev.mjs boots bridge+vite; Playwright drives it)
      - run: echo "wired once the app exists"
```

CI notes grounded in what I measured:
- The `bridge` job's PyMOL build is the long pole. ~110 CPU-seconds of compilation; on a
  4-vCPU GitHub runner budget **3–6 minutes**. Cache `~/.cache/pip` and, better,
  cache the built wheel keyed on `hashFiles('layer*/**','packages/engine/ov/**','packages/engine/contrib/**','setup.py','CMakeLists.txt')`.
- Do **not** gate on `assertImageEqual` tests on macOS — verified to fail
  (`symop_py.TestBondSymOp.test_commands`, diff 73) on arm64.
- `--config-settings testing=True` (the C++ Catch2 tests) should only run on the **Linux**
  job, where `apt install catch2` gives v2.13.

### 6.1 Lint / format / test tooling summary

| concern | tool | config file |
|---|---|---|
| TS/JS lint | ESLint 9 flat config + `typescript-eslint` + `react-hooks` + `react-refresh` | `webclient/eslint.config.js` |
| Format (TS/JS/JSON/MD/YAML) | Prettier 3 | `webclient/.prettierrc.json` |
| Types | `tsc -b` project references across `packages/*` → `apps/web` | `webclient/tsconfig.base.json` + per-package `tsconfig.json` |
| Unit tests (JS) | Vitest 2 (`jsdom` for React, `node` for `@tenmol/protocol`/`client`) | `webclient/vitest.workspace.ts` |
| Component tests | Vitest + `@testing-library/react` | per package |
| E2E | Playwright (chromium only; the app is a localhost single-client tool) | `webclient/playwright.config.ts` |
| Python lint+format | **ruff** (single tool, fast) — note upstream has **no** Python linter config today; ruff is scoped to `webclient/services/bridge` only | `webclient/services/bridge/pyproject.toml` |
| Python tests | pytest 8.2.2 (matches `pyproject.toml:35`) | `webclient/services/bridge/pyproject.toml` |
| C++ format | upstream `.clang-format` already exists (`BreakBeforeBraces: Linux`, `AccessModifierOffset: -2`) — **we add no C++, so nothing to configure** | `/.clang-format` |
| Git hooks | `pre-commit` is already installed on this machine (brew list) but there is **no** `.pre-commit-config.yaml` in the repo — if we add one it must live at `webclient/.pre-commit-config.yaml` and be invoked explicitly, since a root-level one is a new root file | — |

---

## 7. Risks & open questions

### Risks

1. **`mmtf-cpp` is an unavoidable out-of-band dependency.** CI clones it from
   `github.com/rcsb/mmtf-cpp` (`build.yml:42`, `:157`) with no pin, no checksum. Our
   bootstrap does the same. Supply-chain-wise this is a `--depth 1` clone of an unpinned
   default branch executed on every dev machine. Recommend pinning a tag/SHA. (I was not
   permitted to run that clone during this investigation, so I verified the *failure* it
   causes rather than the fix — the `--use-msgpackc=no` path is the one I proved works.)
2. **`use-msgpackc=no` silently amputates features.** It disables MMTF *and* BCIF
   (`packages/engine/layer2/CifFile.cpp:26`, `:491`; `packages/engine/layer3/MoleculeExporter.cpp:1510`, `:1991`, `:1999`;
   `packages/engine/layer2/CifMoleculeReader.cpp:3455`; `packages/engine/layer1/P.cpp:2127`). If the product needs to open
   `.bcif`, `use-msgpackc=no` is not an acceptable default.
3. **The bridge holds a `pymol2.PyMOL` singleton with `os.chdir`-style global state.**
   `pymol2_lock` is an `RLock` (`packages/engine/modules/pymol2/__init__.py:22`) and the build itself
   `os.chdir`s (`setup.py:401`). Concurrency in the bridge must be single-threaded
   command execution with an explicit queue, not an async free-for-all.
4. **A rebuild is required for every C++ change**, and the editable install rebuilds the
   *whole* extension via CMake each time `pip install -e .` runs — but the underlying
   `cmake --build` is incremental, so a targeted
   `cmake --build build/temp.*/\_cmd -j16` is the real inner loop (~1–3 s for one file).
   Document that; do not make devs pay 27 s per C++ edit.
5. **Upstream churn in `setup.py` / `pyproject.toml`.** We depend on `--config-settings`
   flag names surviving. `setup.py:732` already carries a `# TODO: Remove when we move to
   setup-CMake` comment — upstream intends to migrate to a real CMake build. When that lands,
   `bootstrap.sh` breaks. Keep all build invocation in **one** script so the blast radius is
   one file.
6. **Node/pnpm are not pinned by anything today.** `packageManager` + corepack fixes pnpm;
   `.nvmrc` is advisory only. CI must pin explicitly (done above).
7. **`.git/info/exclude` is per-clone.** A fresh clone by a second developer will show the
   editable `.so` as untracked until they run `bootstrap.sh`. Acceptable; documented.
8. **`vitest`/`vite`/`three` versions in §5.1 are the catalog I would start from, not
   versions I verified resolve.** They must be locked by an actual `pnpm install` before
   anyone treats them as truth. Node 22.22.0 and pnpm 9.15.4 *were* verified present.
9. **macOS `OpenGL.framework` is deprecated.** The extension links it unconditionally on
   Darwin (`setup.py:677-678`) even though we never create a context. If Apple removes it,
   the link breaks and there is no flag to avoid it short of `--osx-frameworks=false`,
   which is itself broken (§2.6.4).
10. **PySide6 is in the `dev` extra** (`pyproject.toml:34`). Anyone who runs
    `pip install '.[dev]'` (as `INSTALL` and CI suggest) pulls ~200 MB of Qt we will never
    use, and pinned to `==6.8.1` which may not have arm64/py3.14 wheels. Our bootstrap
    installs the extras à la carte instead.

### Open questions (for the architecture owner, not for me)

1. Do we ship MMTF/BCIF support in v1? That single answer decides whether `bootstrap.sh`
   needs the `mmtf-cpp` clone at all.
2. Should `webclient/` be the pnpm root (my recommendation) or the repo root? Confirm, then
   nobody re-litigates it.
3. Does the bridge run PyMOL **in-process** (import `pymol2` inside the ASGI app) or as a
   **subprocess** the ASGI app talks to? In-process is simpler and matches
   `packages/engine/modules/pymol/pymolhttpd.py:443` (`self_cmd=`), but a hard C++ crash then takes the HTTP
   server down with it. I lean in-process + a supervisor that restarts.
4. Do we adopt the existing `PymolHttpd` JSON envelope (`packages/engine/modules/pymol/pymolhttpd.py:144-173`)
   for compatibility with `packages/engine/modules/web/javascript/pymol.js`, or design a fresh binary-capable
   protocol? Geometry streaming argues strongly for fresh + binary.
5. Do we ever need `--glut=true`? Only if someone wants PyMOL's own window side-by-side with
   the browser for debugging. Currently `false` and everything works.
6. Do we vendor a prebuilt PyMOL wheel per platform (so contributors who only touch React
   never compile C++), and if so where — a GitHub Release, or a private index?
7. Should `docs/` and `webclient/` be merged into one directory to keep the
   diff-vs-upstream to a single path? (Two new top-level paths vs one.)
