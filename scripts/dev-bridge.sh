#!/usr/bin/env bash
# Run the tenmol PyMOL bridge from a venv that has PyMOL built from this tree.
#
# Usage:
#   scripts/dev-bridge.sh                      # ws://127.0.0.1:8765/ws
#   scripts/dev-bridge.sh --tick refresh       # any python -m tenmol_bridge flag
#   TENMOL_VENV=/path/to/venv scripts/dev-bridge.sh
#
# Venv resolution order:
#   1. $TENMOL_VENV
#   2. <repo>/bridge/.venv
#   3. <repo>/.venv
# Build PyMOL into that venv first - see docs/webclient/spikes/00-build.md §8.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BRIDGE_DIR="$REPO_ROOT/bridge"

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

if [ -z "$VENV" ] || [ ! -x "$VENV/bin/activate" ] && [ ! -f "$VENV/bin/activate" ]; then
  cat >&2 <<EOF
dev-bridge: no virtualenv found.

Looked at: \$TENMOL_VENV, $BRIDGE_DIR/.venv, $REPO_ROOT/.venv

Create one and build PyMOL into it (docs/webclient/spikes/00-build.md §8), then:

  python3 -m venv "$BRIDGE_DIR/.venv"
  "$BRIDGE_DIR/.venv/bin/pip" install -e "$BRIDGE_DIR"
  # ...plus PyMOL itself, built from this repo

or point at an existing one:

  TENMOL_VENV=/path/to/venv scripts/dev-bridge.sh
EOF
  exit 1
fi

# shellcheck disable=SC1091
source "$VENV/bin/activate"

# Run from the bridge directory so the package is importable even when it has
# not been pip-installed into the venv yet.
export PYTHONPATH="$BRIDGE_DIR${PYTHONPATH:+:$PYTHONPATH}"
# Spike 00 §6.2: PyMOL exits the process with C exit(), skipping Python
# shutdown, so buffered output is lost. Never buffer.
export PYTHONUNBUFFERED=1

echo "dev-bridge: venv=$VENV" >&2
echo "dev-bridge: python=$(command -v python)" >&2
if PYMOL_PATH_OUT="$(python -c 'import pymol; print(pymol.__file__)' 2>/dev/null)"; then
  echo "dev-bridge: pymol=$PYMOL_PATH_OUT" >&2
else
  echo "dev-bridge: WARNING pymol not importable - bridge will run DEGRADED" >&2
fi

exec python -m tenmol_bridge "$@"
