#!/usr/bin/env bash
# Run the tenmol PyMOL bridge from a venv that has PyMOL built from this tree.
#
# Usage:
#   scripts/dev-bridge.sh                        # ws://127.0.0.1:8765/ws
#   scripts/dev-bridge.sh --port 8799            # any `python -m tenmol_bridge` flag
#   scripts/dev-bridge.sh --exec python -m pytest bridge/tests -q
#   TENMOL_VENV=/path/to/venv scripts/dev-bridge.sh
#
# Venv resolution order:
#   1. $TENMOL_VENV
#   2. <repo>/bridge/.venv        <- what scripts/bootstrap.sh creates
#   3. <repo>/.venv
#
# If there is no venv, run `bash scripts/bootstrap.sh` once. It builds PyMOL
# from this tree (docs/webclient/spikes/00-build.md section 3) into bridge/.venv.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BRIDGE_DIR="$REPO_ROOT/bridge"

# --exec <cmd...>: run an arbitrary command inside the venv instead of the
# bridge itself (used by `pnpm test:bridge`).
EXEC_MODE=0
if [ "${1:-}" = "--exec" ]; then
  EXEC_MODE=1
  shift
fi

find_venv() {
  if [ -n "${TENMOL_VENV:-}" ]; then
    echo "$TENMOL_VENV"
    return
  fi
  for candidate in "$BRIDGE_DIR/.venv" "$REPO_ROOT/.venv"; do
    if [ -x "$candidate/bin/python" ]; then
      echo "$candidate"
      return
    fi
  done
  echo ""
}

VENV="$(find_venv)"

if [ -z "$VENV" ] || [ ! -x "$VENV/bin/python" ]; then
  cat >&2 <<EOF
dev-bridge: no virtualenv found.

Looked at: \$TENMOL_VENV, $BRIDGE_DIR/.venv, $REPO_ROOT/.venv

Bootstrap it once (creates the venv, builds PyMOL from this tree, installs the
bridge, runs pnpm install):

    bash scripts/bootstrap.sh

or point at an existing one:

    TENMOL_VENV=/path/to/venv scripts/dev-bridge.sh
EOF
  exit 1
fi

# Activate without sourcing bin/activate: the script is bash-specific, and all
# it does that matters here is PATH + VIRTUAL_ENV.
export VIRTUAL_ENV="$VENV"
export PATH="$VENV/bin:$PATH"
unset PYTHONHOME || true

# Run from the repo root, with bridge/ on PYTHONPATH so the package imports
# even when it has not been pip-installed into the venv yet.
cd "$REPO_ROOT"
export PYTHONPATH="$BRIDGE_DIR${PYTHONPATH:+:$PYTHONPATH}"
# Spike 00 section 6.2: PyMOL exits the process with C exit(), skipping Python
# shutdown, so buffered output is lost. Never buffer.
export PYTHONUNBUFFERED=1

if [ "$EXEC_MODE" = 1 ]; then
  if [ $# -eq 0 ]; then
    echo "dev-bridge: --exec needs a command" >&2
    exit 2
  fi
  exec "$@"
fi

echo "dev-bridge: venv=$VENV" >&2
echo "dev-bridge: python=$(command -v python)" >&2
if PYMOL_PATH_OUT="$(python -c 'import pymol; print(pymol.__file__)' 2>/dev/null)"; then
  echo "dev-bridge: pymol=$PYMOL_PATH_OUT" >&2
else
  echo "dev-bridge: WARNING pymol not importable - bridge will run DEGRADED" >&2
  echo "dev-bridge:         fix with: bash scripts/bootstrap.sh --force-pymol" >&2
fi

# Fail loudly and legibly when the port is already taken; uvicorn's own version
# of this message is a stack trace.
PORT=8765
prev=""
for arg in "$@"; do
  [ "$prev" = "--port" ] && PORT="$arg"
  prev="$arg"
done
if (exec 3<>"/dev/tcp/127.0.0.1/$PORT") 2>/dev/null; then
  echo "dev-bridge: WARNING something is already listening on 127.0.0.1:$PORT" >&2
  echo "dev-bridge:         (an older bridge? kill it, or pass --port N)" >&2
fi

# The bridge mints a 256-bit token by default and a browser tab cannot read it
# (the WS then closes 4401). For `pnpm dev` to work out of the box, DEV defaults
# to --no-token unless the caller asked for a token explicitly. The boundary is
# still the transport: 127.0.0.1 bind + loopback peer check + Origin allow-list.
# Set TENMOL_DEV_TOKEN=1 to keep token checking on.
WANTS_TOKEN=0
for arg in "$@"; do
  case "$arg" in
    --token|--token=*|--token-file|--token-file=*|--no-token) WANTS_TOKEN=1 ;;
  esac
done
if [ "$WANTS_TOKEN" = 0 ] && [ -z "${TENMOL_DEV_TOKEN:-}" ]; then
  echo "dev-bridge: adding --no-token (dev default; TENMOL_DEV_TOKEN=1 to keep it)" >&2
  set -- --no-token "$@"
fi

exec python -m tenmol_bridge "$@"
