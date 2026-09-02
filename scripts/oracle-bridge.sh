#!/usr/bin/env bash
# Run the REAL-PyMOL oracle bridge from the micromamba `oracle` env that has
# PyMOL built from this tree, with offscreen GL enabled.
#
# GL: the env ships Mesa (`mesa-llvmpipe`) + its glvnd EGL vendor ICD under
# $CONDA_PREFIX/share/glvnd/egl_vendor.d. `tenmol_bridge.glcontext.egl` now
# auto-points glvnd there (see `_ensure_conda_egl_vendor`), so surfaceless
# llvmpipe software GL comes up with no extra env — `gl.available` is true.
#
# Usage:
#   scripts/oracle-bridge.sh                 # ws://127.0.0.1:8002/ws, --no-token
#   scripts/oracle-bridge.sh --port 8003
#   TENMOL_ORACLE_ENV=/path/to/env scripts/oracle-bridge.sh
#   scripts/oracle-bridge.sh --no-gl         # force the headless no-GL baseline
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_PREFIX="${TENMOL_ORACLE_ENV:-/tmp/micromamba/envs/oracle}"

if [ ! -x "$ENV_PREFIX/bin/python" ]; then
  echo "oracle-bridge: no python at $ENV_PREFIX/bin/python" >&2
  echo "oracle-bridge: set TENMOL_ORACLE_ENV to the micromamba/conda env with PyMOL built in." >&2
  exit 1
fi

# Mirror `micromamba run -n oracle` without needing micromamba on PATH.
export CONDA_PREFIX="$ENV_PREFIX"
export PATH="$ENV_PREFIX/bin:$PATH"
export LD_LIBRARY_PATH="$ENV_PREFIX/lib:${LD_LIBRARY_PATH:-}"
unset PYTHONHOME || true

cd "$REPO_ROOT"
export PYTHONPATH="$REPO_ROOT/packages/bridge${PYTHONPATH:+:$PYTHONPATH}"
export PYTHONUNBUFFERED=1

# Default to the oracle port unless the caller passed --port.
have_port=0
for arg in "$@"; do case "$arg" in --port|--port=*) have_port=1 ;; esac; done
if [ "$have_port" = 0 ]; then
  set -- --port 8002 "$@"
fi

echo "oracle-bridge: env=$ENV_PREFIX python=$(command -v python)" >&2
exec python -m tenmol_bridge --no-token "$@"
