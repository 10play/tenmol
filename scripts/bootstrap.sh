#!/usr/bin/env bash
#
# tenmol web client -- one-shot bootstrap (WP-00).
#
# Takes a clean clone with only the platform's native deps installed and leaves
# behind everything `pnpm dev` needs:
#
#   1. packages/bridge/.venv                     python venv, NOT inside git
#   2. .deps/mmtf-cpp                   vendored header-only dep, out of tree
#   3. PyMOL built from THIS tree into packages/bridge/.venv (MMTF + BCIF enabled)
#   4. tenmol-bridge installed editable into the same venv
#   5. pnpm install for the JS workspace
#   6. .git/info/exclude entries for the turds the PyMOL build drops in the
#      upstream tree (local-only file; git never merges it)
#
# Then: `pnpm dev` and `curl 127.0.0.1:8765/healthz` -> {"state":"running",...}
#
# The build recipe is NOT invented here. It is copied verbatim from the
# measured spike: docs/spikes/00-build.md sections 2.2, 3 and 3.1.
# In particular `--config-settings use-msgpackc=c++11` PLUS a vendored mmtf-cpp
# on PREFIX_PATH. Do NOT "fix" a build error by switching to
# `use-msgpackc=no`: that silently drops MMTF and BCIF file I/O, which are
# parity rows (docs/00-parity-inventory.md, section 6 File I/O).
#
# Usage:
#   bash scripts/bootstrap.sh [options]
#
#   --skip-pymol      do not build PyMOL (assume the venv already has it)
#   --skip-node       do not run pnpm install
#   --force-pymol     rebuild PyMOL even if `import pymol` already works
#   --python PATH     interpreter to create the venv from (or $TENMOL_PYTHON)
#   --venv PATH       venv location (default packages/bridge/.venv, or $TENMOL_VENV)
#   -q, --quiet       less pip chatter
#   -h, --help        this text
#
# Environment:
#   TENMOL_PYTHON       interpreter for the venv
#   TENMOL_VENV         venv path
#   TENMOL_DEPS_DIR     vendored C++ header dir (default <repo>/packages/engine/.deps)
#   TENMOL_MMTF_INCLUDE existing mmtf-cpp include dir; skips the git clone
#
set -euo pipefail

# TWO roots. `REPO_ROOT` is this project (`web/`); `REPO_ROOT` is the git root,
# which holds the upstream PyMOL tree, its `setup.py`, and `.git`. The build
# below runs from REPO_ROOT because that is where `setup.py` is; the venv and
# the bridge package live under REPO_ROOT.
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

# ---------------------------------------------------------------------------
# options
# ---------------------------------------------------------------------------
SKIP_PYMOL=0
SKIP_NODE=0
FORCE_PYMOL=0
QUIET=0
PYTHON_BIN="${TENMOL_PYTHON:-}"
VENV="${TENMOL_VENV:-$REPO_ROOT/packages/bridge/.venv}"
# Vendored C++ headers belong to the ENGINE build, so they live beside it.
DEPS_DIR="${TENMOL_DEPS_DIR:-$REPO_ROOT/packages/engine/.deps}"

while [ $# -gt 0 ]; do
  case "$1" in
    --skip-pymol) SKIP_PYMOL=1 ;;
    --skip-node) SKIP_NODE=1 ;;
    --force-pymol) FORCE_PYMOL=1 ;;
    --python) PYTHON_BIN="$2"; shift ;;
    --venv) VENV="$2"; shift ;;
    -q | --quiet) QUIET=1 ;;
    -h | --help)
      sed -n '2,45p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    *)
      echo "bootstrap: unknown option $1 (try --help)" >&2
      exit 2
      ;;
  esac
  shift
done

# ---------------------------------------------------------------------------
# output helpers
# ---------------------------------------------------------------------------
if [ -t 1 ]; then
  C_B=$'\033[1m'; C_G=$'\033[32m'; C_Y=$'\033[33m'; C_R=$'\033[31m'; C_0=$'\033[0m'
else
  C_B=''; C_G=''; C_Y=''; C_R=''; C_0=''
fi

STEP=0
STEPS=7
step() {
  STEP=$((STEP + 1))
  printf '%s==> [%d/%d] %s%s\n' "$C_B" "$STEP" "$STEPS" "$*" "$C_0"
}
info() { printf '    %s\n' "$*"; }
ok() { printf '    %s%s%s\n' "$C_G" "$*" "$C_0"; }
warn() { printf '    %swarning: %s%s\n' "$C_Y" "$*" "$C_0" >&2; }
die() {
  printf '\n%sbootstrap failed: %s%s\n' "$C_R" "$*" "$C_0" >&2
  exit 1
}

PIP_QUIET=()
[ "$QUIET" = 1 ] && PIP_QUIET=(-q)

START_TS=$(date +%s)

# ---------------------------------------------------------------------------
# 1. platform + native deps
# ---------------------------------------------------------------------------
step "platform and native dependencies"

UNAME="$(uname -s)"
case "$UNAME" in
  Darwin) PLATFORM=macos ;;
  Linux) PLATFORM=linux ;;
  *) die "unsupported platform '$UNAME'. macOS and Linux only." ;;
esac
info "platform: $PLATFORM ($(uname -m))"

BREW_PREFIX=""
if [ "$PLATFORM" = macos ]; then
  command -v brew >/dev/null 2>&1 ||
    die "Homebrew is required on macOS. See https://brew.sh"
  BREW_PREFIX="$(brew --prefix)"
  info "brew prefix: $BREW_PREFIX"

  # spikes/00-build.md section 2.1. catch2 is deliberately NOT required: it is
  # only used by --testing=true and brew only ships v3, while packages/engine/layerCTest/Test.h:14
  # wants the v2 umbrella header.
  REQUIRED_BREW=(cmake libpng freetype glew glm netcdf msgpack-cxx libxml2)
  MISSING=()
  for pkg in "${REQUIRED_BREW[@]}"; do
    brew list --versions "$pkg" >/dev/null 2>&1 || MISSING+=("$pkg")
  done
  if [ ${#MISSING[@]} -gt 0 ]; then
    die "missing Homebrew packages: ${MISSING[*]}
    Install them with:
        brew install ${MISSING[*]}"
  fi
  ok "all ${#REQUIRED_BREW[@]} native deps present"
else
  # Debian/Ubuntu names, mirroring .github/workflows/build.yml.
  MISSING=()
  for hdr in \
    /usr/include/png.h \
    /usr/include/GL/glew.h \
    /usr/include/glm/glm.hpp \
    /usr/include/msgpack.hpp; do
    [ -e "$hdr" ] || MISSING+=("$hdr")
  done
  command -v cmake >/dev/null 2>&1 || MISSING+=("cmake")
  if [ ${#MISSING[@]} -gt 0 ]; then
    warn "possibly missing native deps: ${MISSING[*]}"
    warn "on Debian/Ubuntu: sudo apt-get install cmake libfreetype6-dev \\
        libglew-dev libglm-dev libmsgpack-dev libnetcdf-dev libpng-dev libxml2-dev"
  fi
  warn "offscreen GL on Linux (EGL surfaceless) is NOT implemented yet; the
    bridge will start but the viewport will be degraded. See WP-02."
fi

# ---------------------------------------------------------------------------
# 2. python interpreter + venv
# ---------------------------------------------------------------------------
step "python venv at ${VENV#"$REPO_ROOT"/}"

pick_python() {
  if [ -n "$PYTHON_BIN" ]; then
    command -v "$PYTHON_BIN" >/dev/null 2>&1 || die "python not found: $PYTHON_BIN"
    command -v "$PYTHON_BIN"
    return
  fi
  # Prefer an explicit, non-shimmed interpreter. `python3` on a dev machine is
  # very often a pyenv shim or an anaconda python, and setup.py:288 is_conda_env()
  # changes its prefix search when sys.prefix looks conda-ish
  # (spikes/00-build.md section 1).
  local cand
  for ver in 3.13 3.12 3.11 3.10; do
    if [ -n "$BREW_PREFIX" ]; then
      cand="$BREW_PREFIX/opt/python@$ver/bin/python$ver"
      [ -x "$cand" ] && { echo "$cand"; return; }
      cand="$BREW_PREFIX/bin/python$ver"
      [ -x "$cand" ] && { echo "$cand"; return; }
    fi
    cand="/usr/bin/python$ver"
    [ -x "$cand" ] && { echo "$cand"; return; }
  done
  for ver in 3.13 3.12 3.11 3.10; do
    cand="$(command -v "python$ver" 2>/dev/null || true)"
    [ -n "$cand" ] && { echo "$cand"; return; }
  done
  command -v python3 || true
}

if [ ! -x "$VENV/bin/python" ]; then
  BASE_PYTHON="$(pick_python)"
  [ -n "$BASE_PYTHON" ] || die "no python3 found. Install python 3.10+ first."
  info "base interpreter: $BASE_PYTHON"

  PYVER="$("$BASE_PYTHON" -c 'import sys;print("%d.%d"%sys.version_info[:2])')"
  case "$PYVER" in
    3.9 | 3.10 | 3.11 | 3.12 | 3.13) ;;
    *) warn "python $PYVER is untested for this tree (3.13 is the verified one)" ;;
  esac
  if "$BASE_PYTHON" -c 'import sys;sys.exit(0 if ("conda" in sys.version or "Continuum" in sys.version) else 1)'; then
    warn "the chosen interpreter looks conda-flavoured; setup.py:288 is_conda_env()
    changes its prefix search. Pass --python $BREW_PREFIX/bin/python3.13 if the
    build misbehaves."
  fi

  mkdir -p "$(dirname "$VENV")"
  "$BASE_PYTHON" -m venv "$VENV" || die "python -m venv failed"
  ok "created venv (python $PYVER)"
else
  ok "reusing existing venv"
fi

PY="$VENV/bin/python"
[ -x "$PY" ] || die "no interpreter at $PY"

# Build-time deps must be present *before* the PyMOL build, because we pass
# --no-build-isolation (spikes/00-build.md section 3.1).
info "installing build requirements (pip, numpy, setuptools, cmake)"
"$PY" -m pip install "${PIP_QUIET[@]}" --upgrade \
  pip "numpy>=2.0" "setuptools>=69.2.0" "cmake>=3.13.3" >/dev/null ||
  die "could not install build requirements into the venv"
ok "build requirements installed"

# ---------------------------------------------------------------------------
# 3. vendored mmtf-cpp headers (out of tree)
# ---------------------------------------------------------------------------
step "vendored mmtf-cpp headers"

MMTF_ROOT="$DEPS_DIR/mmtf-cpp"
if [ -n "${TENMOL_MMTF_INCLUDE:-}" ]; then
  [ -f "${TENMOL_MMTF_INCLUDE%/}/mmtf.hpp" ] ||
    die "TENMOL_MMTF_INCLUDE=$TENMOL_MMTF_INCLUDE has no mmtf.hpp"
  MMTF_ROOT="$(cd "$(dirname "${TENMOL_MMTF_INCLUDE%/}")" && pwd)"
  ok "using pre-vendored headers: $MMTF_ROOT"
elif [ -f "$MMTF_ROOT/include/mmtf.hpp" ]; then
  ok "already vendored: $MMTF_ROOT/include/mmtf.hpp"
else
  # packages/engine/layer3/MoleculeExporter.cpp:16 does #include <mmtf.hpp>. It is header-only,
  # not in Homebrew, and not in this tree. Upstream CI copies it into packages/engine/include/,
  # but packages/engine/include/ is upstream and we must not touch it -- so it goes out of tree
  # and onto PREFIX_PATH, which setup.py:783-796 scans for an packages/engine/include/ subdir.
  command -v git >/dev/null 2>&1 || die "git is required to vendor mmtf-cpp"
  info "cloning rcsb/mmtf-cpp (header-only) into ${DEPS_DIR#"$REPO_ROOT"/}"
  rm -rf "$DEPS_DIR/mmtf-src" "$MMTF_ROOT"
  mkdir -p "$DEPS_DIR"
  git clone --quiet --depth 1 https://github.com/rcsb/mmtf-cpp.git "$DEPS_DIR/mmtf-src" ||
    die "could not clone mmtf-cpp. Offline? Vendor it by hand and re-run with
    TENMOL_MMTF_INCLUDE=/path/to/mmtf-cpp/include"
  mkdir -p "$MMTF_ROOT"
  cp -R "$DEPS_DIR/mmtf-src/include" "$MMTF_ROOT/include"
  rm -rf "$DEPS_DIR/mmtf-src"
  [ -f "$MMTF_ROOT/include/mmtf.hpp" ] || die "mmtf.hpp missing after vendoring"
  ok "vendored $MMTF_ROOT/include/mmtf.hpp"
fi

# ---------------------------------------------------------------------------
# 4. build PyMOL from this tree
# ---------------------------------------------------------------------------
step "PyMOL build (from this tree, into the venv)"

if [ "$SKIP_PYMOL" = 1 ]; then
  warn "--skip-pymol: not building"
elif [ "$FORCE_PYMOL" = 0 ] && "$PY" -c 'import pymol' >/dev/null 2>&1; then
  ok "$("$PY" -c 'import pymol;print(pymol.get_version_message())') already importable (--force-pymol to rebuild)"
else
  if [ "$PLATFORM" = macos ]; then
    PREFIX_PATH="$BREW_PREFIX:$BREW_PREFIX/opt/libxml2:$MMTF_ROOT"
    # brew's libxml2 is keg-only: without its prefix, libxml/parser.h is not
    # found and -lxml2 does not resolve (spikes/00-build.md section 3.1).
    MACOS_MAJOR="$(sw_vers -productVersion | cut -d. -f1)"
    export MACOSX_DEPLOYMENT_TARGET="${MACOSX_DEPLOYMENT_TARGET:-$MACOS_MAJOR.0}"
    info "MACOSX_DEPLOYMENT_TARGET=$MACOSX_DEPLOYMENT_TARGET"
  else
    PREFIX_PATH="/usr:/usr/local:$MMTF_ROOT"
  fi
  export PREFIX_PATH
  info "PREFIX_PATH=$PREFIX_PATH"
  info "this compiles ~254 objects; ~16 s on an M4 Max, minutes on CI"

  # NOTE: non-editable on purpose. `pip install -e .` drops a 10 MB
  # packages/engine/modules/pymol/_cmd*.so into the source tree (spikes/00-build.md section 4.3).
  # No --glut (default False keeps _PYMOL_NO_MAIN defined), no --testing
  # (needs Catch2 v2).
  BUILD_LOG="$REPO_ROOT/.tenmol-bootstrap.log"
  if "$PY" -m pip install "${PIP_QUIET[@]}" --no-build-isolation \
    --config-settings use-msgpackc=c++11 "$REPO_ROOT/packages/engine" >"$BUILD_LOG" 2>&1; then
    ok "$("$PY" -c 'import pymol;print(pymol.get_version_message())') built and installed"
    rm -f "$BUILD_LOG"
  else
    tail -40 "$BUILD_LOG" >&2 || true
    die "PyMOL build failed. Full log: $BUILD_LOG
    Do NOT work around this with --config-settings use-msgpackc=no: it disables
    MMTF and BCIF I/O, which are parity rows."
  fi

  # pip leaves an untracked egg-info in the upstream tree (section 4.2).
  rm -rf "$REPO_ROOT/packages/engine/modules/pymol.egg-info"
fi

# ---------------------------------------------------------------------------
# 5. bridge (editable)
# ---------------------------------------------------------------------------
step "tenmol-bridge (editable install)"

if [ -f "$REPO_ROOT/packages/bridge/pyproject.toml" ]; then
  "$PY" -m pip install "${PIP_QUIET[@]}" -e "$REPO_ROOT/packages/bridge[dev]" >/dev/null ||
    die "pip install -e packages/bridge/ failed"
  ok "tenmol_bridge importable: $("$PY" -c 'import tenmol_bridge;print(tenmol_bridge.__version__)')"
else
  warn "packages/bridge/pyproject.toml not found -- skipping (WP-02 owns it)"
fi

# ---------------------------------------------------------------------------
# 6. git hygiene: exclude the build turds, locally
# ---------------------------------------------------------------------------
step "git exclude entries for build turds"

EXCLUDE_FILE="$REPO_ROOT/.git/info/exclude"
if [ -d "$REPO_ROOT/.git" ]; then
  mkdir -p "$REPO_ROOT/.git/info"
  touch "$EXCLUDE_FILE"
  ADDED=0
  # .git/info/exclude is local-only and is never merged, so these survive an
  # upstream merge without ever appearing in a diff.
  for pat in \
    "packages/engine/modules/pymol.egg-info/" \
    "packages/engine/testing/timings.tab" \
    "packages/engine/modules/pymol/_cmd*.so" \
    "packages/engine/modules/chempy/champ/_champ*.so"; do
    if ! grep -qxF "$pat" "$EXCLUDE_FILE"; then
      if [ "$ADDED" = 0 ]; then
        printf '\n# --- added by scripts/bootstrap.sh (tenmol web client) ---\n' \
          >>"$EXCLUDE_FILE"
        ADDED=1
      fi
      printf '%s\n' "$pat" >>"$EXCLUDE_FILE"
    fi
  done
  if [ "$ADDED" = 1 ]; then ok "appended to .git/info/exclude"; else ok "already present"; fi
else
  warn "not a git checkout -- skipping .git/info/exclude"
fi

# ---------------------------------------------------------------------------
# 7. node workspace
# ---------------------------------------------------------------------------
step "pnpm workspace"

if [ "$SKIP_NODE" = 1 ]; then
  warn "--skip-node: not running pnpm install"
else
  command -v node >/dev/null 2>&1 || die "node >= 22 is required. brew install node"
  NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
  [ "$NODE_MAJOR" -ge 22 ] ||
    die "node $(node -v) is too old; this workspace needs >= 22 (package.json engines)"
  if ! command -v pnpm >/dev/null 2>&1; then
    if command -v corepack >/dev/null 2>&1; then
      info "enabling pnpm via corepack"
      corepack enable >/dev/null 2>&1 || true
    fi
  fi
  command -v pnpm >/dev/null 2>&1 ||
    die "pnpm not found. Install it: corepack enable && corepack prepare pnpm@9.15.4 --activate"
  info "node $(node -v), pnpm $(pnpm --version)"
  pnpm install || die "pnpm install failed"
  ok "workspace installed"
fi

# ---------------------------------------------------------------------------
# done
# ---------------------------------------------------------------------------
ELAPSED=$(($(date +%s) - START_TS))
printf '\n%sbootstrap complete in %ds%s\n' "$C_G" "$ELAPSED" "$C_0"
cat <<EOF

  venv     $VENV
  deps     $MMTF_ROOT
  next     pnpm dev            # bridge on 127.0.0.1:8765, vite on 5173
           curl 127.0.0.1:8765/healthz
           pnpm run doctor     # re-run the preflight ('doctor' alone hits pnpm's builtin)

EOF
