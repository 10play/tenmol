#!/usr/bin/env bash
#
# tenmol web client -- Linux offscreen GL acceptance test (spike 07 §3).
#
# Proves, by RUNNING it, that packages/bridge/tenmol_bridge/glcontext/egl.py gives PyMOL
# a real desktop-OpenGL context with no GPU, no X/Wayland and no /dev/dri:
#
#   1. EGL_MESA_platform_surfaceless display + eglBindAPI(EGL_OPENGL_API)
#   2. a desktop GL context (NOT GLES), one FBO bound before PyMOL's first draw
#   3. glReadPixels of a known clear colour
#   4. the FBO *name* survives resize (PyMOL latches it -- packages/engine/layer5/PyMOL.cpp:2236)
#   5. EGL's thread rules: cross-thread steal refused, hand-off works
#   6. eglTerminate refcounting: releasing one context does not kill another
#   7. a REAL PyMOL cartoon render read back non-blank
#   8. the backend pick pass (ScenePicking) actually selects atoms
#
# On Linux it can run directly against packages/bridge/.venv. Anywhere else (this was
# developed on macOS) it runs the whole thing inside a Debian container with
# Mesa llvmpipe, which is also exactly what .github/workflows/webclient-gl-linux.yml
# does on the ubuntu runners without the container.
#
# Usage:
#   bash scripts/test-gl-linux.sh [options]
#
#   --native          run against this machine's python/venv (Linux only)
#   --quick           skip the PyMOL build; validate EGL + FBO + readback only
#   --runtime NAME    docker | podman | nerdctl   (default: first one found)
#   --image NAME      image tag to build/reuse
#                     (default tenmol-gl-linux:quick / :full -- the two images
#                      have DIFFERENT contents and must not share a tag)
#   --rebuild         force a fresh image build
#   --out DIR         where to drop the rendered PNGs
#                     (default $TMPDIR/tenmol-gl-out -- outside the repo, so a
#                      run cannot leave a committable turd behind)
#   --python PATH     interpreter for --native (default packages/bridge/.venv/bin/python)
#   -h, --help        this text
#
# Exit status is the validator's: 0 = every assertion held.
#
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

NATIVE=0
QUICK=0
REBUILD=0
RUNTIME=""
IMAGE=""
# NOT inside the repo. `.tenmol-gl-out` is not in .gitignore, so the documented
# default used to leave two untracked PNGs in the working tree after every run
# -- and .github/workflows/webclient-gl-linux.yml asserts the tree stays clean.
# Same reasoning as apps/web/vite.config.ts's frame directory.
OUT_DIR="${TMPDIR:-/tmp}/tenmol-gl-out"
PYTHON_BIN="$REPO_ROOT/packages/bridge/.venv/bin/python"

while [ $# -gt 0 ]; do
  case "$1" in
    --native) NATIVE=1 ;;
    --quick) QUICK=1 ;;
    --rebuild) REBUILD=1 ;;
    --runtime) RUNTIME="$2"; shift ;;
    --image) IMAGE="$2"; shift ;;
    --out) OUT_DIR="$2"; shift ;;
    --python) PYTHON_BIN="$2"; shift ;;
    -h | --help)
      sed -n '2,36p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    *) echo "test-gl-linux: unknown option $1 (try --help)" >&2; exit 2 ;;
  esac
  shift
done

# The --quick image is Mesa + system python3 and has NO /venv and NO PyMOL; the
# full image builds PyMOL into /venv. They are DIFFERENT images, so they must
# not share a tag -- with one tag, a full run after a quick run "reused" the
# quick image and died with
#   exec: "/venv/bin/python": stat /venv/bin/python: no such file or directory
# which says nothing about the actual cause. Default the tag per mode. Resolved
# after parsing so `--quick` may follow `--image`.
if [ -z "$IMAGE" ]; then
  IMAGE="tenmol-gl-linux:$([ "$QUICK" = 1 ] && echo quick || echo full)"
fi

if [ -t 1 ]; then
  C_B=$'\033[1m'; C_G=$'\033[32m'; C_Y=$'\033[33m'; C_R=$'\033[31m'; C_0=$'\033[0m'
else
  C_B=''; C_G=''; C_Y=''; C_R=''; C_0=''
fi
say()  { printf '%s==> %s%s\n' "$C_B" "$*" "$C_0"; }
warn() { printf '    %swarning: %s%s\n' "$C_Y" "$*" "$C_0" >&2; }
die()  { printf '\n%stest-gl-linux failed: %s%s\n' "$C_R" "$*" "$C_0" >&2; exit 1; }

WORK="$(mktemp -d "${TMPDIR:-/tmp}/tenmol-gl.XXXXXX")"
cleanup() { rm -rf "$WORK"; }
trap cleanup EXIT

mkdir -p "$OUT_DIR"

# ===========================================================================
# The validator. Deliberately stdlib-only (plus tenmol_bridge + pymol) so it
# runs in a bare container.
# ===========================================================================
cat >"$WORK/validate_gl.py" <<'PYEOF'
"""Linux offscreen GL acceptance test. Every check is an assert; no check is
skipped silently -- a skip prints SKIP and says why."""
import ctypes
import os
import struct
import sys
import threading
import time
import zlib

OUT = os.environ.get("TENMOL_GL_OUT", ".")
QUICK = os.environ.get("TENMOL_GL_QUICK") == "1"
W, H = 320, 240

FAILS = []
def check(label, ok, detail=""):
    print("  %-42s %s  %s" % (label, "PASS" if ok else "FAIL", detail))
    if not ok:
        FAILS.append(label)
    return ok

def section(title):
    print("\n== %s %s" % (title, "=" * max(0, 62 - len(title))))

from tenmol_bridge.glcontext import egl

# ---------------------------------------------------------------- 1. probe
section("1. probe (no context created)")
info = egl.probe()
print("  libEGL              : %s" % info.get("eglLib"))
print("  libGL               : %s" % info.get("libGL"))
print("  client extensions   : %d" % len(info.get("clientExtensions") or []))
check("probe() reports ok", bool(info.get("ok")), info.get("error", ""))
check("EGL_MESA_platform_surfaceless advertised",
      "EGL_MESA_platform_surfaceless" in (info.get("clientExtensions") or []))
check("libGL.so.1 loadable", not str(info.get("libGL", "")).startswith("missing"))

# ------------------------------------------------------- 2. desktop context
section("2. surfaceless desktop-GL context")
ctx = egl.create_context(W, H)
gl = ctx.gl
i = ctx.info()
for k in ("backend", "eglPlatform", "eglVersion", "eglVendor", "surface", "api",
          "desktopGL", "vendor", "renderer", "version", "glsl", "fbo",
          "colorBits", "depthBits", "fboEntryPoints", "extensionCount"):
    print("  %-20s: %s" % (k, i.get(k)))
if i.get("warnings"):
    for w_ in i["warnings"]:
        print("  warning             : %s" % w_)
check("platform is surfaceless", i["eglPlatform"] == "surfaceless", i["eglPlatform"])
check("DESKTOP GL, not GLES", i["desktopGL"] is True and i["api"] == "gl")
check("GL_VERSION is not 'OpenGL ES'", not gl.is_gles(), i["version"])
check("GL >= 2.0 (PyMOL shader path)", ctx.gl_version >= (2, 0), str(ctx.gl_version))
check("ARB (not EXT) framebuffer entry points", i["fboEntryPoints"] == "ARB")
check("RGBA8 colour", i["colorBits"] == [8, 8, 8, 8], str(i["colorBits"]))
check("depth buffer present", i["depthBits"] >= 16, str(i["depthBits"]))
check("FBO bound before any draw",
      gl.get_int(egl.GL_FRAMEBUFFER_BINDING) == ctx.fbo == i["fbo"])

# ------------------------------------------------------------ 3. readback
section("3. clear + glReadPixels")
gl.glClearColor(0.25, 0.5, 0.75, 1.0)
gl.glClear(egl.GL_COLOR_BUFFER_BIT | egl.GL_DEPTH_BUFFER_BIT)
gl.glFinish()
buf = (ctypes.c_ubyte * (W * H * 4))()
gl.glReadPixels(0, 0, W, H, egl.GL_RGBA, egl.GL_UNSIGNED_BYTE,
                ctypes.cast(buf, ctypes.c_void_p))
err = gl.glGetError()
px = list(buf[:4])
print("  glGetError          : %s" % err)
print("  pixel (0,0)         : %s" % px)
check("glReadPixels raised no GL error", err == egl.GL_NO_ERROR, str(err))
check("readback == the colour we cleared to", px == [64, 128, 191, 255], str(px))
check("every pixel is non-blank",
      all(buf[k] for k in range(0, W * H * 4, 4)))

# -------------------------------------------------------------- 4. resize
section("4. resize keeps the FBO NAME (packages/engine/layer5/PyMOL.cpp:2236)")
ids = [ctx.fbo]
for w_, h_ in ((640, 480), (1280, 800), (400, 300), (W, H)):
    ctx.resize(w_, h_)
    ids.append(ctx.fbo)
print("  fbo ids across 4 resizes: %s" % ids)
check("FBO name never regenerated", len(set(ids)) == 1, str(ids))
check("size tracked", (ctx.width, ctx.height) == (W, H))
check("still bound after resize", gl.get_int(egl.GL_FRAMEBUFFER_BINDING) == ctx.fbo)

# ------------------------------------------------------- 5. thread rules
section("5. EGL thread affinity")
res = []
def stealer():
    try:
        ctx.make_current()
        res.append(("steal", "SUCCEEDED"))
    except Exception as exc:
        res.append(("steal", "refused: %s" % str(exc)[:70]))
t = threading.Thread(target=stealer); t.start(); t.join()
print("  cross-thread steal  : %s" % res[0][1])
check("a second thread may NOT steal the context", res[0][1].startswith("refused"))

ok_unbind = ctx.release_current()
handoff = []
def taker():
    try:
        ctx.make_current()
        handoff.append(gl.get_int(egl.GL_FRAMEBUFFER_BINDING))
        ctx.release_current()
    except Exception as exc:
        handoff.append("FAIL %s" % exc)
t = threading.Thread(target=taker); t.start(); t.join()
print("  release_current()   : %s" % ok_unbind)
print("  hand-off binding    : %s" % handoff[0])
check("release_current() then another thread binds it",
      ok_unbind and handoff[0] == ctx.fbo, str(handoff))
ctx.make_current()
check("owner re-binds afterwards", ctx.is_current())

# ---------------------------------------- 6. eglTerminate is refcounted
section("6. two contexts on one EGLDisplay")
a = egl.create_context(32, 32)
b = egl.create_context(32, 32)
shared = a._dpy.value == b._dpy.value
print("  same EGLDisplay     : %s" % shared)
a.release()
b.make_current()
b.gl.glClearColor(0.0, 1.0, 0.0, 1.0)
b.gl.glClear(egl.GL_COLOR_BUFFER_BIT)
b.gl.glFinish()
small = (ctypes.c_ubyte * 4)()
b.gl.glReadPixels(0, 0, 1, 1, egl.GL_RGBA, egl.GL_UNSIGNED_BYTE,
                  ctypes.cast(small, ctypes.c_void_p))
berr = b.gl.glGetError()
print("  b after a.release() : pixel=%s glGetError=%s" % (list(small), berr))
check("releasing one context does not break the other",
      list(small) == [0, 255, 0, 255] and berr == egl.GL_NO_ERROR)
b.release()
ctx.make_current()

if QUICK:
    print("\nTENMOL_GL_QUICK=1: skipping the PyMOL sections")
else:
    # ------------------------------------------------------- 7. real PyMOL
    section("7. a REAL PyMOL render through this context")
    import pymol, pymol2
    o = pymol.invocation.options
    o.no_gui = 0            # => pmgui=1 => HaveGUI=1 => SceneRender runs
    o.internal_gui = 0
    o.internal_feedback = 0
    o.external_gui = 0
    o.show_splash = 0
    o.read_stdin = 0
    o.sigint_handler = 0
    o.quiet = 1
    p = pymol2.SingletonPyMOL()
    p.start()
    cmd = p.cmd
    p.reshape(W, H, 1)
    cmd.viewport(W, H)
    pdb = os.environ["TENMOL_TEST_PDB"]
    cmd.load(pdb, "mol")
    cmd.hide("everything")
    cmd.show("cartoon", "mol")
    cmd.spectrum("count", "rainbow", "mol and name CA")
    cmd.bg_color("black")
    cmd.orient("mol")
    print("  %s -> %d atoms" % (os.path.basename(pdb), cmd.count_atoms("mol")))

    ctx.make_current()
    t0 = time.perf_counter()
    p.draw(); p.idle(); p.draw()
    draw_ms = (time.perf_counter() - t0) * 1e3
    gerr = gl.glGetError()
    print("  draw                : %.1f ms, glGetError=%s" % (draw_ms, gerr))
    check("PyMOL drew with no GL error", gerr == egl.GL_NO_ERROR, str(gerr))
    check("PyMOL still draws into OUR fbo",
          gl.get_int(egl.GL_FRAMEBUFFER_BINDING) == ctx.fbo)

    from tenmol_bridge.render.framestream import PixelReadback
    rb = PixelReadback(ctx)
    pix, read_ms = rb.read(W, H)
    print("  PixelReadback source: %s (%.2f ms)" % (rb.source, read_ms))
    check("Mode P reads back through ctx.gl", rb.source == "context.gl", rb.source)
    nonblack = sum(1 for k in range(0, W * H * 4, 4)
                   if pix[k] or pix[k + 1] or pix[k + 2])
    print("  non-black pixels    : %d / %d (%.1f%%)"
          % (nonblack, W * H, 100.0 * nonblack / (W * H)))
    check("the rendered image is NOT blank", nonblack > W * H * 0.02,
          "%d px" % nonblack)

    # write the evidence
    rows = [b"\x00" + bytes(pix[y * W * 4:(y + 1) * W * 4])
            for y in range(H - 1, -1, -1)]        # glReadPixels is bottom-up
    def _chunk(tag, data):
        return (struct.pack(">I", len(data)) + tag + data
                + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF))
    png = (b"\x89PNG\r\n\x1a\n"
           + _chunk(b"IHDR", struct.pack(">IIBBBBB", W, H, 8, 6, 0, 0, 0))
           + _chunk(b"IDAT", zlib.compress(b"".join(rows), 6))
           + _chunk(b"IEND", b""))
    dst = os.path.join(OUT, "linux-egl-pymol.png")
    with open(dst, "wb") as fh:
        fh.write(png)
    print("  wrote               : %s (%d bytes)" % (dst, len(png)))

    # ------------------------------------------------------- 8. pick pass
    section("8. the backend pick pass (packages/engine/layer1/ScenePicking.cpp)")
    def pump(seconds):
        end = time.time() + seconds
        while time.time() < end:
            p.idle(); p.draw(); time.sleep(0.005)
    cmd.set("mouse_selection_mode", 0)
    cmd.show("spheres", "mol and name CA")
    pump(0.2)
    cmd.deselect()
    picked = []
    for (x, y) in ((W // 2, H // 2), (W // 2 + 20, H // 2 + 10),
                   (W // 2 - 30, H // 2 - 20)):
        p.button(0, 0, x, y, 0)     # P_GLUT_LEFT, DOWN
        pump(0.03)
        p.button(0, 1, x, y, 0)     # UP
        pump(0.45)
        if "sele" in cmd.get_names("selections") and cmd.count_atoms("sele"):
            picked.append((x, y, cmd.get_model("sele").atom[0].name))
            cmd.deselect(); pump(0.05)
    print("  clicks that selected: %d/3  %s" % (len(picked), picked))
    check("clicking selects an atom (this is what needs GL)", len(picked) >= 1)

    # ----------------------------------------------- 9. ray needs no GL
    section("9. cmd.ray -- the CPU tracer")
    t0 = time.perf_counter()
    cmd.ray(W, H)
    cmd.png(os.path.join(OUT, "linux-ray.png"))
    ray_s = time.perf_counter() - t0
    ray_bytes = os.path.getsize(os.path.join(OUT, "linux-ray.png"))
    print("  cmd.ray %dx%d       : %.3f s -> %d bytes" % (W, H, ray_s, ray_bytes))
    check("cmd.ray produced an image", ray_bytes > 1000, "%d bytes" % ray_bytes)

    p.stop()

ctx.release()
ctx.release()   # idempotent

section("RESULT")
if FAILS:
    print("  %d FAILED: %s" % (len(FAILS), ", ".join(FAILS)))
    sys.exit(1)
print("  all checks passed")
PYEOF

# ===========================================================================
# native path
# ===========================================================================
if [ "$NATIVE" = 1 ]; then
  [ "$(uname -s)" = "Linux" ] || die "--native needs Linux; this is $(uname -s).
    Drop --native to run the same validator in a container."
  [ -x "$PYTHON_BIN" ] || die "no interpreter at $PYTHON_BIN (--python PATH)"
  say "native run: $($PYTHON_BIN -V)"
  export TENMOL_GL_OUT="$OUT_DIR"
  export TENMOL_GL_QUICK="$QUICK"
  export TENMOL_TEST_PDB="$REPO_ROOT/packages/engine/test/dat/1tii.pdb"
  export PYTHONPATH="$REPO_ROOT/packages/bridge${PYTHONPATH:+:$PYTHONPATH}"
  exec "$PYTHON_BIN" "$WORK/validate_gl.py"
fi

# ===========================================================================
# container path
# ===========================================================================
if [ -z "$RUNTIME" ]; then
  for cand in docker podman nerdctl; do
    if command -v "$cand" >/dev/null 2>&1; then RUNTIME="$cand"; break; fi
  done
fi
[ -n "$RUNTIME" ] || die "no container runtime found (docker/podman/nerdctl) and
    this is not Linux, so --native is unavailable. Install Docker Desktop,
    colima, podman or OrbStack -- or just push: .github/workflows/webclient-gl-linux.yml
    runs exactly this validation on ubuntu-22.04 and ubuntu-24.04."
"$RUNTIME" info >/dev/null 2>&1 || die "$RUNTIME is installed but its daemon is
    not reachable. Start it and retry."
say "runtime: $RUNTIME ($("$RUNTIME" --version 2>/dev/null | head -1))"

# --- build context: tracked files only, from the WORKING TREE -------------
#
# `git ls-files` lists what the INDEX knows about, which includes files deleted
# in the working tree but not yet committed. tar then aborts the whole run with
# `Cannot stat: No such file or directory` and this script reported only "could
# not pack the source tree" -- observed for real, mid-refactor, with one deleted
# doc. Skip what is gone and say so; the container needs sources, not an
# opinion about the developer's staging area.
say "packing sources (tracked files, working-tree state)"
command -v git >/dev/null 2>&1 || die "git is required to build the image context"
(
  cd "$REPO_ROOT" || exit 1
  git ls-files -z | while IFS= read -r -d '' f; do
    if [ -e "$f" ]; then
      printf '%s\0' "$f"
    else
      printf '    skipping %s (tracked, deleted in the working tree)\n' "$f" >&2
    fi
  done | tar -czf "$WORK/src.tar.gz" --null -T -
) || die "could not pack the source tree"
printf '    %s\n' "$(du -h "$WORK/src.tar.gz" | cut -f1) of sources"

MESA_PKGS="libegl1 libegl-mesa0 libgl1 libglx-mesa0 libgl1-mesa-dri libopengl0 libglvnd0"
BUILD_PKGS="build-essential cmake git ca-certificates python3 python3-dev python3-venv \
python3-pip libfreetype6-dev libglew-dev libglm-dev libmsgpack-dev libnetcdf-dev \
libpng-dev libxml2-dev"

if [ "$QUICK" = 1 ]; then
  cat >"$WORK/Dockerfile" <<EOF
FROM debian:bookworm-slim
ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update && apt-get install --no-install-recommends -y \\
      $MESA_PKGS python3 ca-certificates \\
    && rm -rf /var/lib/apt/lists/*
WORKDIR /src
COPY src.tar.gz /tmp/src.tar.gz
RUN tar -xzf /tmp/src.tar.gz -C /src && rm /tmp/src.tar.gz
ENV PYTHONPATH=/src/packages/bridge
ENV LIBGL_ALWAYS_SOFTWARE=1
ENV GALLIUM_DRIVER=llvmpipe
EOF
  PY_IN_IMAGE=python3
else
  cat >"$WORK/Dockerfile" <<EOF
FROM debian:bookworm-slim
ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update && apt-get install --no-install-recommends -y \\
      $MESA_PKGS $BUILD_PKGS \\
    && rm -rf /var/lib/apt/lists/*
RUN python3 -m venv /venv \\
    && /venv/bin/pip install -q --upgrade pip "numpy>=2.0" "setuptools>=69.2.0" "cmake>=3.13.3"
# header-only mmtf-cpp, OUT of the source tree and onto PREFIX_PATH
# (scripts/bootstrap.sh step 3; packages/engine/include/ is upstream and must not be touched)
RUN git clone --depth 1 --quiet https://github.com/rcsb/mmtf-cpp.git /tmp/mmtf-src \\
    && mkdir -p /deps/mmtf-cpp && cp -R /tmp/mmtf-src/include /deps/mmtf-cpp/include \\
    && rm -rf /tmp/mmtf-src && test -f /deps/mmtf-cpp/include/mmtf.hpp
WORKDIR /src
COPY src.tar.gz /tmp/src.tar.gz
RUN tar -xzf /tmp/src.tar.gz -C /src && rm /tmp/src.tar.gz
# Same invocation as scripts/bootstrap.sh step 4. use-msgpackc=c++11 is load
# bearing: use-msgpackc=no would silently drop MMTF and BCIF I/O.
ENV PREFIX_PATH=/usr:/usr/local:/deps/mmtf-cpp
RUN /venv/bin/pip install -q --no-build-isolation \\
      --config-settings use-msgpackc=c++11 /src/packages/engine \\
    && /venv/bin/python -c "import pymol; print(pymol.get_version_message())"
RUN /venv/bin/pip install -q -e /src/packages/bridge
ENV LIBGL_ALWAYS_SOFTWARE=1
ENV GALLIUM_DRIVER=llvmpipe
EOF
  PY_IN_IMAGE=/venv/bin/python
fi

NEED_BUILD=1
if [ "$REBUILD" = 0 ] && "$RUNTIME" image inspect "$IMAGE" >/dev/null 2>&1; then
  say "reusing image $IMAGE (--rebuild to force)"
  NEED_BUILD=0
fi
if [ "$NEED_BUILD" = 1 ]; then
  say "building $IMAGE (Debian bookworm + Mesa$([ "$QUICK" = 1 ] || echo " + PyMOL from this tree"))"
  "$RUNTIME" build -f "$WORK/Dockerfile" -t "$IMAGE" "$WORK" >"$WORK/build.log" 2>&1 || {
    tail -40 "$WORK/build.log" >&2
    die "image build failed (full log was $WORK/build.log)"
  }
  grep -E '^#[0-9]+ +[0-9.]+ PyMOL ' "$WORK/build.log" | tail -1 || true
fi

say "running the validator with NO GPU, NO X, NO /dev/dri"
set +e
"$RUNTIME" run --rm \
  -v "$WORK/validate_gl.py:/validate_gl.py:ro" \
  -v "$OUT_DIR:/out" \
  -e TENMOL_GL_OUT=/out \
  -e TENMOL_GL_QUICK="$QUICK" \
  -e TENMOL_TEST_PDB=/src/packages/engine/test/dat/1tii.pdb \
  -e PYTHONPATH=/src/packages/bridge \
  -w /tmp \
  "$IMAGE" "$PY_IN_IMAGE" /validate_gl.py
STATUS=$?
set -e

if [ "$STATUS" = 0 ]; then
  printf '\n%sLinux offscreen GL: VALIDATED%s  (images in %s)\n' \
    "$C_G" "$C_0" "${OUT_DIR#"$REPO_ROOT"/}"
else
  printf '\n%sLinux offscreen GL: FAILED (exit %d)%s\n' "$C_R" "$STATUS" "$C_0" >&2
fi
exit "$STATUS"
