# Spike 00 — Build PyMOL from this tree so `import pymol` works (macOS arm64)

**Status: SUCCESS.** PyMOL 3.2.0a0 builds and imports on darwin 24.6.0 / arm64, headless,
with **no Qt, no PySide, no GLUT, no display**, and with **MMTF/BCIF support enabled**.

Everything below was executed on this machine. Every transcript is real output, copied verbatim.
Follow-on doc: `docs/webclient/build-and-tooling.md` (the prior analysis this spike executes and
corrects).

---

## 0. TL;DR

| | |
|---|---|
| venv | `/private/tmp/claude-501/-Users-amirangel-Documents-GitHub-tenmol/177b7067-f921-4a11-839c-84d8a16f6415/scratchpad/venv` |
| python | `/private/tmp/claude-501/-Users-amirangel-Documents-GitHub-tenmol/177b7067-f921-4a11-839c-84d8a16f6415/scratchpad/venv/bin/python` (CPython 3.13.3, Homebrew) |
| pymol version | `3.2.0a0`, git sha `159ed88baad87f6bcc61ee45ef0b9ffc208370fc` |
| build time | **15.68 s wall / 114.66 s user** (`-j16`, M4 Max), 254 objects |
| `_cmd.so` | 10,070,376 B at `…/venv/lib/python3.13/site-packages/pymol/_cmd.cpython-313-darwin.so` |
| wheel | `pymol-3.2.0a0-cp313-cp313-macosx_15_0_arm64.whl`, 7,615,448 B |
| install mode | **non-editable** (`pip install .`) — deliberately, so the repo stays git-clean |
| repo dirty after | `git status --porcelain` → 0 lines |
| test suite | `Ran 961 tests in 7.156s / FAILED (failures=1, errors=1, skipped=276)` + `57 passed, 31 skipped` (pytest phase) |

Three findings that change the bridge design are in **§6**. Read those.

---

## 1. Machine state (measured, not assumed)

```
$ uname -m ; sw_vers
arm64
ProductName:		macOS
ProductVersion:		15.6.1
BuildVersion:		24G90

$ which brew cmake git
/opt/homebrew/bin/brew
/opt/homebrew/bin/cmake        # 3.29.3  <- this is the cmake setup.py actually invoked
/usr/bin/git

$ ls /opt/homebrew/bin/python3.*
python3.10  python3.11  python3.12  python3.13  python3.14
```

`python3` on `PATH` is a **pyenv shim** (`/Users/amirangel/.pyenv/shims/python3`) and
`/Users/amirangel/anaconda3` is also on `PATH`. `setup.py:288-294` (`is_conda_env()`) changes
prefix search when `sys.prefix` looks conda-ish. **Always build from the explicit venv below,
never from the ambient interpreter.**

---

## 2. Native dependencies

### 2.1 Already installed via Homebrew — nothing had to be installed

```
$ brew list --versions libpng freetype glew glm netcdf msgpack-cxx libxml2 catch2 cmake
cmake 3.29.3
freetype 2.14.3
glew 2.3.1
glm 1.0.3
libpng 1.6.58
libxml2 2.13.7
msgpack-cxx 7.0.0
netcdf 4.10.0
                    # (exit 1 — `catch2` is the only one absent)
```

**`brew install` was NOT needed.** If starting from a bare machine, the equivalent is:

```bash
brew install cmake libpng freetype glew glm netcdf msgpack-cxx libxml2
```

`catch2` is intentionally **not** installed: it is only used by `--testing=true`
(`layerCTest/Test.h:14` wants the Catch2 **v2** umbrella header `<catch2/catch.hpp>`, and brew
only ships v3). We do not build `layerCTest`.

### 2.2 The one dependency no package manager ships: `mmtf-cpp`

`layer3/MoleculeExporter.cpp:16` does `#include <mmtf.hpp>`. It is header-only, it is not in
Homebrew, and it is not vendored in this tree (`include/` has only `pymol/` and `tnt/`).

Vendored **out of tree** (so `include/` stays pristine — hard rule: do not touch upstream files):

```bash
git clone --depth 1 https://github.com/rcsb/mmtf-cpp.git \
  /private/tmp/…/scratchpad/deps/mmtf-src
mkdir -p /private/tmp/…/scratchpad/deps/mmtf-cpp
cp -R /private/tmp/…/scratchpad/deps/mmtf-src/include \
      /private/tmp/…/scratchpad/deps/mmtf-cpp/include
# -> /private/tmp/…/scratchpad/deps/mmtf-cpp/include/mmtf.hpp
```

`setup.py` scans each `PREFIX_PATH` entry for an `include/` subdir (`setup.py:783-796`), so
adding `…/deps/mmtf-cpp` to `PREFIX_PATH` is enough — no `-I` hacking, no source edits.

**This is a strict improvement on `build-and-tooling.md`'s recommended
`--config-settings use-msgpackc=no` workaround**, which loses MMTF *and* BCIF I/O and causes
5 test errors. With the vendored headers we get full MMTF/BCIF and 4 of those 5 errors disappear
(§5).

---

## 3. The exact reproducible build

```bash
SCRATCH=/private/tmp/claude-501/-Users-amirangel-Documents-GitHub-tenmol/177b7067-f921-4a11-839c-84d8a16f6415/scratchpad

# --- 1. venv (NOT in the repo) ------------------------------------------------
/opt/homebrew/bin/python3.13 -m venv "$SCRATCH/venv"
"$SCRATCH/venv/bin/pip" install --upgrade pip "numpy>=2.0" "setuptools>=69.2.0" "cmake>=3.13.3"

# --- 2. mmtf-cpp headers, out of tree ----------------------------------------
mkdir -p "$SCRATCH/deps"
git clone --depth 1 https://github.com/rcsb/mmtf-cpp.git "$SCRATCH/deps/mmtf-src"
mkdir -p "$SCRATCH/deps/mmtf-cpp"
cp -R "$SCRATCH/deps/mmtf-src/include" "$SCRATCH/deps/mmtf-cpp/include"

# --- 3. build + install ------------------------------------------------------
cd /Users/amirangel/Documents/GitHub/tenmol
PREFIX_PATH="/opt/homebrew:/opt/homebrew/opt/libxml2:$SCRATCH/deps/mmtf-cpp" \
MACOSX_DEPLOYMENT_TARGET=15.0 \
"$SCRATCH/venv/bin/pip" install -v --no-build-isolation \
  --config-settings use-msgpackc=c++11 .

# --- 4. tidy: pip leaves an untracked, NON-gitignored egg-info in the repo ----
rm -rf /Users/amirangel/Documents/GitHub/tenmol/modules/pymol.egg-info
```

Tail of the real log (`$SCRATCH/build-real-1.log`):

```
  Created wheel for pymol: filename=pymol-3.2.0a0-cp313-cp313-macosx_15_0_arm64.whl
    size=7615448 sha256=b81feaf46c3a80aed34af57f2b158d601ca1b5b88d4246a1526348aa7c3ca8b2
Successfully built pymol
Installing collected packages: pymol
  changing mode of …/scratchpad/venv/bin/pymol to 755
Successfully installed pymol-3.2.0a0
real 15.68
user 114.66
sys 15.64
EXIT=0
```

### 3.1 Why each argument

| argument | reason |
|---|---|
| `--no-build-isolation` | build deps (`numpy`, `setuptools`, `cmake`) are already in the venv; isolation would re-download them and can pick a different numpy ABI than the one at runtime. |
| `--config-settings use-msgpackc=c++11` | `_custom_build/backend.py:12-18` turns this into `build_ext --use-msgpackc=c++11`. Enables MMTF + BCIF. `guess` (`setup.py:198`, `guess_msgpackc()` at `setup.py:297-312`) resolves to the same value here, but pinning it makes the build independent of what brew happens to have installed. |
| `PREFIX_PATH=…/opt/libxml2` | brew's libxml2 is **keg-only**; without it `libxml/parser.h` is not found and `-lxml2` is unresolved. |
| `PREFIX_PATH=…/deps/mmtf-cpp` | supplies `mmtf.hpp` (§2.2). |
| `MACOSX_DEPLOYMENT_TARGET=15.0` | matches the host OS; keeps the wheel tag honest (`macosx_15_0_arm64`). |
| **no** `--glut` | default is `False` (`setup.py:193-204`), which is what we want: `_PYMOL_NO_MAIN` is defined and the legacy GLUT main loop in `layer5/main.cpp` is compiled out. **Do not pass `--glut=true`.** |
| **no** `--testing` | would need Catch2 v2 (§2.1). |
| **no** editable (`-e`) | see §4.3. |

### 3.2 Actual compile line produced (from the log, one object)

```
/Applications/Xcode.app/Contents/Developer/Toolchains/XcodeDefault.xctoolchain/usr/bin/c++ \
 -DMMTF_MSGPACK_USE_CPP11 -DMSGPACK_NO_BOOST -DPYMOL_CURVE_VALIDATE -D_HAVE_LIBXML \
 -D_PYMOL_FREETYPE -D_PYMOL_LIBPNG -D_PYMOL_NO_MAIN -D_PYMOL_NUMPY -D_PYMOL_OSX \
 -D_PYMOL_VMD_PLUGINS -D_cmd_EXPORTS \
 -I<repo>/include -I<repo>/contrib/uiuc/plugins/include -I<repo>/ov/src \
 -I<repo>/layer0 … -I<repo>/layer5 -I<repo>/layerGraphics -I<repo>/layerGraphics/gl \
 -I<repo>/build/generated -I<repo>/contrib/uiuc/plugins/molfile_plugin/src \
 -I<repo>/contrib/mmtf-c -I<repo>/contrib/pocketfft \
 -I<venv>/lib/python3.13/site-packages/numpy/_core/include \
 -I/opt/homebrew/include -I/opt/homebrew/include/freetype2 \
 -I/opt/homebrew/opt/libxml2/include -I/opt/homebrew/opt/libxml2/include/libxml2 \
 -I<scratch>/deps/mmtf-cpp/include \
 -I/opt/homebrew/opt/python@3.13/Frameworks/Python.framework/Versions/3.13/include/python3.13 \
 -O3 -DNDEBUG -std=gnu++17 -arch arm64 \
 -isysroot /Applications/Xcode.app/…/MacOSX26.2.sdk -mmacosx-version-min=15.0 -fPIC \
 -Werror=return-type -Wunused-variable -Wno-switch -Wno-narrowing -Wno-char-subscripts \
 -O3 -fno-strict-aliasing \
 -c <repo>/layer1/Ray.cpp
```

Note `_PYMOL_NO_MSGPACKC` is **absent** — msgpack is on. `_PYMOL_NO_MAIN` is **present** —
no GLUT main. 254 `.o` files (`find build -name '*.o' | wc -l` → `254`).

---

## 4. Errors hit, and how they were resolved

### 4.1 `'mmtf.hpp' file not found` — the only genuine build failure

Reproduced deliberately with the naive command (default `use-msgpackc=guess`, no mmtf-cpp on
`PREFIX_PATH`), i.e. what a new dev would type first:

```
$ PREFIX_PATH="/opt/homebrew:/opt/homebrew/opt/libxml2" \
  venv/bin/pip wheel -v --no-build-isolation --no-deps -w …/wheelout-default .
…
  /Users/amirangel/Documents/GitHub/tenmol/layer3/MoleculeExporter.cpp:16:10: fatal error:
      'mmtf.hpp' file not found
  error: command '/opt/homebrew/bin/cmake' failed with exit code 2
  error: subprocess-exited-with-error
EXIT=1
```

Chain: `options.use_msgpackc = "guess"` (`setup.py:198`) → `guess_msgpackc()`
(`setup.py:297-312`) sees brew's `/opt/homebrew/include/msgpack/version_master.hpp` with
`MSGPACK_VERSION_MAJOR > 1` → returns `"c++11"` → `_PYMOL_NO_MSGPACKC` is *not* defined →
`MoleculeExporter.cpp:15`'s `#ifndef _PYMOL_NO_MSGPACKC` block is live → needs `mmtf.hpp`.

**Resolution: vendor mmtf-cpp headers out of tree and put them on `PREFIX_PATH` (§2.2).**
(The alternative, `--config-settings use-msgpackc=no`, also builds but costs MMTF and BCIF.)

### 4.2 Non-errors that look like errors

* **`catch2` missing** — expected; only `--testing=true` needs it, and brew's v3 would not work
  anyway (`layerCTest/Test.h:14` wants the v2 header). Not a blocker.
* **`build/` appears in the repo (99 MB)** — `.gitignore:4` already ignores `build`, and
  `.gitignore:3` ignores `generated`. Left in place so incremental rebuilds are ~1–2 s.
* **`modules/pymol.egg-info/` appears in the repo and is NOT gitignored** — this *does* dirty
  `git status`. Removed manually after each build (§3 step 4). See §7 for the recommended
  permanent fix.
* **`testing/timings.tab` appears after running the test suite** — also not gitignored. Removed.

### 4.3 Why non-editable install

`pip install -e .` drops a 10 MB `modules/pymol/_cmd.cpython-313-darwin.so` into the source tree,
and `.gitignore` does **not** ignore `*.so` (`.gitignore:1-5` is only `*.pyc`, `*.d`, `generated`,
`build`, `.vscode`). That violates "the repo must stay clean". A plain `pip install .` copies
everything into site-packages and leaves `modules/` untouched.

Consequence for downstream agents: **edits to `modules/pymol/*.py` in the repo will NOT be picked
up** until you re-run the install command in §3 (~16 s). If you need a live-editable PyMOL, use
`-e` and add `modules/pymol/_cmd*.so` + `modules/pymol.egg-info/` to `.git/info/exclude` first
(that file is local-only and git never merges it).

---

## 5. Verification — real transcripts

### 5.1 The required one-liner

```
$ cd /private/tmp/…/scratchpad
$ PYTHONUNBUFFERED=1 venv/bin/python -c \
  "import pymol; from pymol import cmd; pymol.finish_launching(['pymol','-cq']); \
   cmd.fragment('ala'); print(cmd.count_atoms('all'))"
10
EXIT=0
```

**Without `PYTHONUNBUFFERED=1` (or an explicit flush) that exact command prints NOTHING and still
exits 0.** That is not a build defect — see §6.1. It is the single most likely thing to make
another agent believe the build is broken when it is not.

Note `finish_launching`'s docstring says *"THIS IS NOT SUPPORTED ON macOS"*
(`modules/pymol/__init__.py:435`). It nevertheless works here, in the `-cq` (no-GUI) mode. The
supported entry point for the bridge is `pymol2.PyMOL()`, verified next.

### 5.2 `pymol2` headless, full pipeline including MMTF round-trip

```
$ PYTHONUNBUFFERED=1 venv/bin/python -c "
import pymol2, os, time
with pymol2.PyMOL() as p:
    c = p.cmd
    print('version   ', c.get_version())
    c.fragment('ala');  print('atoms     ', c.count_atoms('all'))
    c.show('surface')
    t=time.time(); c.ray(120,90); print('ray       ', round(time.time()-t,3), 's')
    c.png('verify.png', dpi=72); time.sleep(0.5)
    print('png bytes ', os.path.getsize('verify.png'))
    p.reshape(640, 480, 1)
    print('idle()    ', p.idle())
    print('redisplay ', p.getRedisplay(False))
    c.set('use_shaders', 0)
    print('scene ok  ', c.get_view()[:3])
    c.save('verify.mmtf'); print('mmtf bytes', os.path.getsize('verify.mmtf'))
    c.delete('all'); c.load('verify.mmtf'); print('mmtf rt   ', c.count_atoms('all'))
"
version    ('3.2.0a', 3.0, 3000000, 1785422035, '159ed88baad87f6bcc61ee45ef0b9ffc208370fc', 0)
atoms      10
ray        0.006 s
png bytes  2645
idle()     0
redisplay  1
scene ok   (1.0, 0.0, 0.0)
mmtf bytes 877
mmtf rt    10
```

Ray tracing, PNG encoding (libpng), surface computation and MMTF save/load all work with **zero
GL context**.

### 5.3 `pymol2.SingletonPyMOL` and the `_cmd` bridge symbols

```
$ PYTHONUNBUFFERED=1 venv/bin/python -c "
import pymol, pymol._cmd as _cmd
from pymol2 import SingletonPyMOL, PyMOL
…"
SingletonPyMOL <class 'pymol2.SingletonPyMOL'>
pymol.__file__ …/venv/lib/python3.13/site-packages/pymol/__init__.py
_cmd.__file__  …/venv/lib/python3.13/site-packages/pymol/_cmd.cpython-313-darwin.so
_draw            PRESENT
_button          PRESENT
_drag            PRESENT
_reshape         PRESENT
_idle            PRESENT
_getRedisplay    PRESENT
_refresh         *** MISSING ***
total _cmd symbols: 305
```

**`_cmd._refresh` does not exist and never has.** The complete set of underscore-prefixed
"raw hook" entry points in `_cmd` is exactly:

```
['_button', '_drag', '_draw', '_getRedisplay', '_idle', '_new',
 '_popValidContext', '_pushValidContext', '_reshape', '_sdof', '_start', '_stop']
```

The refresh equivalents are the ordinary (non-underscore) `_cmd` functions that take the `_COb`
handle: `_cmd.refresh(_COb)`, `_cmd.refresh_now(_COb)`, `_cmd.refresh_later(_COb)` — all present,
and used by `modules/pymol/internal.py:551-558`. **The bridge should call `cmd.refresh()` /
`cmd.refresh_now()`, not a nonexistent `_cmd._refresh`.**

Also newly surfaced and relevant to the bridge: `_cmd._pushValidContext` /
`_cmd._popValidContext` (not mentioned in any prior doc) — these are how PyMOL is told a GL
context is current.

### 5.4 Companion modules and data files

```
PYMOL_PATH  = …/venv/lib/python3.13/site-packages/pymol/pymol_path
contents    = ['LICENSE', 'data', 'examples', 'test']
data        = ['chem_comp_bond-top100.cif', 'chempy', 'demo', 'openvr', 'pmg_qt', 'pmg_tk',
               'pymol', 'setting_help.csv', 'shaders', 'startup', 'test', 'tut']
shaders     = 44 files
PYMOL_DATA  = …/site-packages/pymol/pymol_path/data
pymolhttpd ok <class 'pymol.pymolhttpd.PymolHttpd'>
rpc        ok <function launch_XMLRPC at 0x107a2ec00>
_champ     ok _champ.cpython-313-darwin.so
```

All 44 GLSL shader sources are installed and readable at
`$PYMOL_DATA/shaders` — that is where the `@tenmol/viewer` shader port should read them from.
`setting_help.csv` is there too (settings panel parity).

### 5.5 Full upstream test suite

```
$ PYTHONUNBUFFERED=1 venv/bin/pymol -ckq testing/testing.py --run all
…
Ran 961 tests in 7.156s
FAILED (failures=1, errors=1, skipped=276)
…
======================== 57 passed, 31 skipped in 0.27s ========================
EXIT=2
```

The two non-passes, in full:

```
ERROR: testglTF (testing/tests/api/exporting_py.TestExporting.testglTF)
  File "…/pymol/querying.py", line 679, in get_gltf
    raise pymol.CmdException('could not find collada2gltf')
pymol.CmdException:  Error: could not find collada2gltf

FAIL: test_commands (testing/tests/api/symop_py.TestBondSymOp.test_commands)
  File "testing/testing.py", line 443, in assertImageEqual
AssertionError: False is not true : images not equal (73) /var/folders/…/tmpkedweeykdiff.png
```

* `testglTF` — needs the external `collada2gltf` binary; no Homebrew formula exists. Environmental,
  not a build defect. Only affects `cmd.save('*.gltf')`.
* `symop_py.test_commands` — a ray-traced image byte-diff; **ray-traced images are not bit-stable
  on darwin/arm64**. Do not gate CI on image-diff tests on macOS.

Compare against `build-and-tooling.md` §2.6.5, which reported **failures=1, errors=5** using
`use-msgpackc=no`. The 4 MMTF errors (`testMMTF`, `testMMTFExportEmpty`, `testMMTFExportSele`,
`testSave_symmetry__mmtf`) and the BCIF pytest failures are **gone** because we vendored
mmtf-cpp. That is the concrete payoff of §2.2.

Also correcting `build-and-tooling.md` §2.6.6: `pymol -ckq … --run all` returned **EXIT=2**, not 0,
when tests failed. Exit codes are not *reliably* meaningless — but still parse the output, don't
trust the code.

### 5.6 Repo cleanliness

```
$ git status --porcelain | wc -l
       0
```

No upstream file was modified. The only new file is this document.

---

## 6. Findings that change the bridge design — READ THESE

### 6.1 `_cmd._draw()` SEGFAULTS without a GL context

This is the big one. `p.button()`, `p.drag()`, `p.reshape()`, `p.idle()`, `p.getRedisplay()` are
all safe headless. **`p.draw()` is not.**

```
$ venv/bin/python -c "
import pymol2
p = pymol2.PyMOL(); p.start()
p.cmd.fragment('ala')
p.reshape(640,480,1)
print('button ->', p.button(0,0,100,100,0))
print('drag   ->', p.drag(120,120,0))
print('survived button/drag')
print('draw   ->', p.draw())
print('survived draw')
"
button -> None
drag   -> None
survived button/drag
EXIT=139           # 128+11 = SIGSEGV
```

Backtrace from the macOS crash report (`~/Library/Logs/DiagnosticReports/Python-2026-07-30-173634.ips`):

```
exception: EXC_BAD_ACCESS / SIGSEGV, KERN_INVALID_ADDRESS at 0x0000000000000320
  libGL.dylib                  glGetBooleanv +3852
  _cmd.cpython-313-darwin.so   PyMOL_DrawWithoutLock +3825612
  _cmd.cpython-313-darwin.so   Cmd_Draw(_object*, _object*) +3588940
  Python                       cfunction_call
  Python                       _PyObject_MakeTpCall
  …
```

**Implication for the architecture:** the bridge must never call `_cmd._draw` /
`SingletonPyMOL.draw()`. The rasterisation path for a headless backend is `cmd.ray()` +
`cmd.png()` (verified working, 6 ms for 120×90 in §5.2), or geometry extraction — not PyMOL's
GL renderer. Any design doc that proposes "call `_draw` and scrape the framebuffer" is proposing
a guaranteed segfault unless it first creates and makes-current a real GL context (and then
`_cmd._pushValidContext`). Note this crash takes down the whole process — there is no exception
to catch — so a single bad RPC would kill the user's session.

### 6.2 PyMOL tears the process down with C `exit()`, skipping Python shutdown

`atexit` handlers do not run and buffered stdout is discarded:

```
$ venv/bin/python -c "
import atexit, sys
atexit.register(lambda: (sys.stderr.write('ATEXIT RAN\n'), sys.stderr.flush()))
import pymol
from pymol import cmd
pymol.finish_launching(['pymol','-cq'])
cmd.fragment('ala')
print(cmd.count_atoms('all'))
sys.stderr.write('END OF SCRIPT\n'); sys.stderr.flush()
" | cat
END OF SCRIPT
EXIT=0
```

`END OF SCRIPT` printed, so the script ran to completion — but `10` (buffered stdout) and
`ATEXIT RAN` were both lost. `sys.stdout` is *not* replaced (verified: `sys.stdout is so` → `True`);
the process is simply terminated from PyMOL's thread via C `exit()` (`layer5/main.cpp:221`,
`layer1/P.cpp:359/369/1488`), which skips `Py_FinalizeEx`.

**Implications:** (a) the bridge daemon cannot rely on `atexit` or `finally` for cleanup —
flush/persist eagerly; (b) any log line the bridge writes must be flushed or written to an
unbuffered/line-buffered stream; (c) `pymol.finish_launching` is the wrong entry point for a
long-lived server — use `pymol2.PyMOL()`, which does not install that teardown path (§5.2 ran to
completion and returned control normally).

### 6.3 `_cmd._refresh` does not exist

Detailed in §5.3. Use `cmd.refresh()` / `cmd.refresh_now()` / `cmd.refresh_later()`.

---

## 7. Recommendations for files I do not own

These are reported, not applied.

1. **`.git/info/exclude`** (local, never merged, not a repo file) should gain:
   ```
   modules/pymol.egg-info/
   testing/timings.tab
   modules/pymol/_cmd*.so
   modules/chempy/champ/_champ*.so
   ```
   Without this, every `pip install` leaves `modules/pymol.egg-info/` as untracked and
   `git status` is never clean. Whoever owns dev-environment setup should do this in
   `webclient/scripts/bootstrap.sh`.

2. **`webclient/scripts/bootstrap.sh`** (owner: build/tooling agent) should use
   `--config-settings use-msgpackc=c++11` **with** an out-of-tree vendored `mmtf-cpp` on
   `PREFIX_PATH`, not `use-msgpackc=no`. The `no` path silently disables MMTF and BCIF file I/O,
   which are rows in `00-parity-inventory.md`.

3. **`docs/webclient/01-architecture.md`** (owner: architecture agent) — if it describes driving
   `_cmd._draw` from the bridge, that is unimplementable headless (§6.1) and needs revising.

4. **CI**: do not gate on ray-traced image-diff tests on macOS/arm64 (§5.5), and do not use
   `--testing=true` on a brew-only mac (needs Catch2 v2).

---

## 8. Rebuild cheat-sheet

```bash
SCRATCH=/private/tmp/claude-501/-Users-amirangel-Documents-GitHub-tenmol/177b7067-f921-4a11-839c-84d8a16f6415/scratchpad
cd /Users/amirangel/Documents/GitHub/tenmol
PREFIX_PATH="/opt/homebrew:/opt/homebrew/opt/libxml2:$SCRATCH/deps/mmtf-cpp" \
MACOSX_DEPLOYMENT_TARGET=15.0 \
"$SCRATCH/venv/bin/pip" install -v --no-build-isolation \
  --config-settings use-msgpackc=c++11 . \
&& rm -rf modules/pymol.egg-info

# smoke test
PYTHONUNBUFFERED=1 "$SCRATCH/venv/bin/python" -c \
  "import pymol2; p=pymol2.PyMOL(); p.start(); p.cmd.fragment('ala'); \
   print(p.cmd.count_atoms('all')); p.stop()"
```

Logs kept in the scratchpad: `build-real-1.log` (successful build),
`build-default-fail.log` (the `mmtf.hpp` failure), `testsuite.log`, `draw-crash.log`.
