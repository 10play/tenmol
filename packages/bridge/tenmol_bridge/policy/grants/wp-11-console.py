"""WP-11 (console) — tab completion.

`00-parity-inventory.md` row "Command line ▸ Tab completion" is PyMOL's own
`Parser.complete` (`packages/engine/modules/pymol/parser.py:524-596`), reached exactly the way
every PyMOL front end reaches it::

    packages/engine/modules/pymol/_gui.py:899-903
        st = self.cmd._parser.complete(self.command_get())
        if st:
            self.command_set(st)
            self.command_set_cursor(len(st))

    packages/engine/modules/pmg_qt/pymol_qt_gui.py:421-424   Key_Tab -> self.complete()

There is no browser-side implementation of that and there cannot be one: it
reads `cmd.kwhash` (every registered keyword), `cmd.auto_arg` (the per-argument
`Shortcut` tables built by `packages/engine/modules/pymol/completing.py`), `cmd.get_names` and
the SERVER's filesystem via `glob.glob(exp_path(...))`.  Measured on this build,
one round trip each:

    'frag'             -> 'fragment '            commands
    'colo'             -> 'color'                + ' parser: matching commands:'
    'color ye'         -> 'color yellow'         colour names (auto_arg)
    'zoom my'          -> 'zoom mysele'          selection names
    'delete al'        -> 'delete alanine '      object names
    'set cartoon_tra'  -> None                   + settings list (ambiguous)
    'load /etc/hos'    -> 'load /etc/hosts'      SERVER file paths
    'colour'           -> None                   + ' parser: no matching commands.'

Why a grant and not a code change: `_parser` is a private *interior* segment,
and `policy/base.py` refuses those unless the whole dotted path is granted.
This file grants that one path and nothing else — not `cmd._parser.parse`, not
`cmd._parser` as a namespace.

`complete` is read-only with respect to PyMOL state (it takes `cmd.lockcm`,
enumerates names/settings and globs paths), so it is neither `dangerous` nor
does it invalidate anything.  The candidate list it prints goes through
`colorprinting.suggest` -> `print` -> `pcatch` -> the Ortho line buffer, i.e.
out on the `feedback` topic, which is precisely the parity behaviour: PyMOL's
own console prints the candidates and completes the common prefix in place.
"""

from __future__ import annotations

# Absolute, not relative: grant files are loaded by PATH under a synthetic
# module name (`policy/__init__.py:_load_grant_file`), so `__package__` is not
# `tenmol_bridge.policy.grants` and a relative import would resolve elsewhere.
from tenmol_bridge.policy.base import Grant

GRANT = Grant(
    wp="WP-11",
    note="tab completion: cmd._parser.complete (packages/engine/modules/pymol/parser.py:524)",
    symbols={"cmd._parser.complete"},
)
