"""WP-16 (wizards) — the wizard protocol namespace.

WHAT IS GRANTED
---------------
The root ``wizards``, whose six leaves are the whole wizard contract:

    wizards.probe()        cheap, side-effect-free liveness poll
    wizards.snapshot()     panel + prompt + event mask (HAS SIDE EFFECTS)
    wizards.menu(tag)      get_menu(tag) with callables resolved
    wizards.exec_code(s)   a panel row's `code`, run by PParse server-side
    wizards.event(kind,..) one masked event, gated like CWizard::isEventType
    wizards.launch/replace/dismiss/catalog

None of it is reachable any other way.  ``cmd.get_wizard()`` returns a **Python
object**, and the protocol lives in that object's methods
(``get_panel``/``get_prompt``/``get_menu``/``do_pick``/…,
``packages/engine/layer1/Wizard.cpp:162-501``).  The dispatcher resolves dotted *module* paths,
so ``cmd.get_wizard().get_panel()`` is not expressible on the wire — hence a
service module rather than a passthrough.

HOW THE MODULE BECOMES ADDRESSABLE (and the change WP-02 should make)
---------------------------------------------------------------------
``tenmol_bridge/dispatch.py`` maps a root that is not ``cmd``/``chempy`` to
``pymol.<root>``::

    _ROOT_MODULES: Dict[str, str] = {"cmd": "pymol.cmd", "chempy": "chempy"}
    ...
    module_path = _ROOT_MODULES.get(root, "pymol.%s" % root)
    root_obj = __import__(module_path, fromlist=["__name__"])

``dispatch.py`` belongs to WP-02, and plan §5.1 rule 1 says a work package that
needs a change elsewhere *reports* it rather than making it.  So this file
registers the service module under the name the dispatcher will look for, which
is a one-line, reversible, in-process alias:

    sys.modules["pymol.wizards"] = tenmol_bridge.panels.wizards

``__import__("pymol.wizards", fromlist=[...])`` returns a name already present
in ``sys.modules`` **without importing the parent package** (CPython
``importlib._bootstrap._find_and_load`` short-circuits on ``sys.modules``;
verified on this build), so nothing here drags ``pymol`` onto the asyncio
thread at policy-build time — which matters, because the engine imports PyMOL
on its own thread during ``boot()`` and the import order is load-bearing
(``packages/bridge/tests/conftest.py`` documents the chempy/PYMOL_DATA hazard).

REQUESTED UPSTREAM: add ``"wizards": "tenmol_bridge.panels.wizards"`` to
``_ROOT_MODULES`` and this seeding disappears.

DANGEROUSNESS
-------------
``exec_code`` runs a wizard-supplied command string through ``cmd.do`` — the
PyMOL command language, which can do anything (``sculpting.py:175`` is raw
inline Python; ``demo.py:195`` runs ``run $PYMOL_DATA/demo/cgo03.py``).  It is
marked ``dangerous`` with the same honesty as ``cmd.do`` itself and declares
``resync`` invalidation, because after a wizard button the object list, the
geometry and the view can all have changed.
"""

from __future__ import annotations

import importlib
import sys

# Absolute, not relative: grant files are loaded by PATH under a synthetic
# module name (`policy/__init__.py:_load_grant_file`).
from tenmol_bridge.policy.base import Grant

#: The alias described above.  `import_module` rather than `from ... import`
#: because `panels/__init__.py` is a frozen barrel with a PEP 562 `__getattr__`
#: that only knows the four panels the plan listed.
_SERVICE = importlib.import_module("tenmol_bridge.panels.wizards")
sys.modules.setdefault("pymol.wizards", _SERVICE)

GRANT = Grant(
    wp="WP-16",
    note=(
        "wizard protocol: get_panel/get_prompt/get_menu/do_* proxied through "
        "tenmol_bridge.panels.wizards (aliased as pymol.wizards)"
    ),
    roots={"wizards"},
    dangerous={
        "exec_code": (
            "runs a wizard panel/menu command string through PParse "
            "(packages/engine/layer1/Wizard.cpp:573)"
        ),
    },
    invalidates={
        "exec_code": ("resync",),
        "event": ("resync",),
        "launch": ("resync",),
        "replace": ("resync",),
        "dismiss": ("resync",),
    },
)
