"""File I/O data feed — the server-side half of parity area 6 (WP-18).

Everything PyMOL loads or saves is a **server-side path string**.
``cmd.load`` runs the name through ``_self.exp_path`` (``packages/engine/modules/pymol/
importing.py:751``) and hands the *path* to C; ``cmd.save`` does the same
(``packages/engine/modules/pymol/exporting.py:836-838``); format dispatch is on the extension,
not the content (``importing.py:41-109``).  A browser ``File`` blob has no
path, so the web client cannot use a native file dialog — it needs a
**server-side path browser rendered in React**, which is what this module
feeds.  That is the recommendation of ``docs/file-io.md`` §0 and it
is what is implemented here.

WHY THIS IS A ``cmd.*`` NAMESPACE AND NOT A ``_bridge.*`` ROUTE
--------------------------------------------------------------
``_bridge.*`` is dispatched by :meth:`tenmol_bridge.server.BridgeServer.
bridge_route`, and ``server.py`` is owned by WP-02 — a file this work package
must not touch (plan §5.2, the anti-collision rule).  The policy, however,
already addresses the whole ``cmd`` namespace including non-private interior
segments (``policy/base.py`` — only ``_``-prefixed interior segments need an
explicit grant), so :func:`install` attaches this service to ``pymol.cmd`` as
``cmd.tenmol_files`` and every method is reachable as an ordinary
``{t:'call', fn:'cmd.tenmol_files.<method>'}`` with no shared file edited and
no policy grant needed.

Bootstrap: the client sends one ``{t:'do'}`` with

    import tenmol_bridge.panels.files as _tf; _tf.install()

PyMOL's parser executes a non-keyword line as Python
(``packages/engine/modules/pymol/parser.py``), so that is a single round trip and the module
installs itself on the engine thread, inside the PyMOL process.

THREADING
---------
Every method here runs on the **engine thread** (the dispatcher submits to the
pump), so it must never block for long.  Directory listings and ``stat`` are
microseconds.  The one genuinely slow thing — the PDBe assembly/chain lookup
the Get-PDB dialog does (``file_dialogs.py:409-441``, which Qt runs through
``AsyncFunc``) — is therefore split into :meth:`FilesAPI.pdbe_start` (spawns a
worker thread, returns immediately) and :meth:`FilesAPI.pdbe_result` (polls).
A blocking ``urlopen`` on the engine thread would freeze the 60 Hz draw pump.
"""

from __future__ import annotations

import base64
import fnmatch
import glob as _glob
import os
import re
import sys
import threading
import time
from typing import Any, Dict, List, Optional, Sequence

__all__ = [
    "ATTR",
    "FilesAPI",
    "install",
    "uninstall",
    "installed",
    "classify_filename",
    "with_extension",
    "MOVIE_ENCODER_SUPPORT",
    "LOAD_FILTERS",
    "SAVE_MOLECULE_FILTERS",
    "SAVE_UNAVAILABLE_FORMATS",
    "SESSION_FILTERS",
    "GEOMETRY_EXPORTS",
    "LOG_FILTERS",
    "RUN_FILTERS",
    "MOVIE_FILTERS",
    "PNG_RENDERING_MODES",
    "MAE_MULTIPLEX_CHOICES",
    # WP-18 wave 6 — rows 259 / 293 / 295 / 298 of the parity inventory
    "REFUSED_FORMATS",
    "PWG_REFUSAL",
    "MAP_GENERATE_BUILD_NOTE",
    "MISSING_AMPLITUDES_HELP",
    "MISSING_PHASES_HELP",
    "map_rep_plan",
    "map_generate_prefix",
    "PSW_PRESET_STEPS",
    "DialogBroker",
    "BridgeFileDialog",
    "engine_thread",
    "install_tk_filedialog",
    "uninstall_tk_filedialog",
    "tk_filedialog_installed",
]

#: Attribute name on ``pymol.cmd``.  Deliberately namespaced: the client
#: addresses ``cmd.tenmol_files.browse``, three segments, which is exactly the
#: policy's ``MAX_SEGMENTS``.
ATTR = "tenmol_files"

# --------------------------------------------------------------------------
# Static tables, copied verbatim from the Qt front-end this replaces.
# --------------------------------------------------------------------------

#: ``file_dialogs.py:539-551`` — Export Molecule dialog.
SAVE_MOLECULE_FILTERS: Sequence[str] = (
    "PDBx/mmCIF (*.cif *.cif.gz)",
    "PDB (*.pdb *.pdb.gz)",
    "PQR (*.pqr)",
    "MOL2 (*.mol2)",
    "MDL SD (*.sdf *.mol)",
    "Maestro (*.mae)",
    "MacroModel (*.mmd *.mmod *.dat)",
    "ChemPy Pickle (*.pkl)",
    "XYZ (*.xyz)",
    "MMTF (*.mmtf)",
    "By Extension (*.*)",
)

#: Formats whose **export** half fails or silently no-ops in this build.
#:
#: Deliberately NOT ``incentive_only.UNAVAILABLE_FORMATS``, which is about the
#: **import** half.  The two disagree, measured (``test_p8_a6.py``):
#:
#: * ``.mae`` cannot be LOADED (``loadfunctions['mae']`` is the Incentive
#:   sentinel) but ``cmd.save('x.mae')`` writes a real Maestro file, so the
#:   save picker must not annotate it;
#: * ``.mtl`` is in neither manifest yet always raises ``.MTL export not
#:   implemented`` (``exporting.py:983-984``);
#: * ``.obj`` reports success either way: ``cmd.get_mtl_obj`` is "an incomplete
#:   and unsupported feature" (``querying.py:585-600``) that only exports
#:   TRIANGLES, so a lines-only scene writes 0 bytes and says nothing.
SAVE_UNAVAILABLE_FORMATS: Dict[str, str] = {
    ".stl": "STL export not supported by this PyMOL build (lazyio.get_stlstr raises)",
    ".gltf": "needs the external collada2gltf binary, which is not present",
    ".glb": "needs the external collada2gltf binary, which is not present",
    ".mtl": ".MTL export not implemented (exporting.py:983 raises)",
    ".obj": (
        "get_mtl_obj exports triangles only: a lines-only scene writes 0 bytes"
    ),
}

#: ``pymol_qt_gui.py:657-661`` — Save Session As.
SESSION_FILTERS: Sequence[str] = (
    "PyMOL Session File (*.pse *.pze *.pse.gz)",
    "PyMOL Show File (*.psw *.pzw *.psw.gz)",
)

#: ``pymol_qt_gui.py:793-821`` — Export Image As ▸ geometry formats.
#: ``format`` is what ``cmd.save(fname, format=...)`` is given.
GEOMETRY_EXPORTS: Sequence[Dict[str, str]] = (
    {"label": "VRML 2", "filter": "VRML 2 WRL File (*.wrl)", "format": "wrl"},
    {"label": "COLLADA", "filter": "COLLADA File (*.dae)", "format": "dae"},
    {"label": "GLTF", "filter": "GLTF File (*.gltf)", "format": "gltf"},
    {"label": "POV-Ray", "filter": "POV File (*.pov)", "format": "pov"},
    {"label": "STL", "filter": "STL File (*.stl)", "format": "stl"},
)

#: ``pymol_qt_gui.py:823-827`` — LOG_FORMATS.
LOG_FILTERS: Sequence[str] = (
    "PyMOL Script (*.pml)",
    "Python Script (*.py *.pym)",
    "All (*)",
)

#: ``pymol_qt_gui.py:848-855`` — Run Script.
RUN_FILTERS: Sequence[str] = (
    "All Runnable (*.pml *.py *.pym)",
    "PyMOL Command Script (*.pml)",
    "PyMOL Command Script (*.txt)",
    "Python Script (*.py *.pym)",
    "Python Script (*.txt)",
    "All Files(*)",
)

#: ``file_dialogs.py:694-700``.
MOVIE_FILTERS: Dict[str, str] = {
    "png": "Numbered PNG Files (*.png)",
    "mp4": "MPEG 4 movie file (*.mp4)",
    "mpg": "MPEG 1 movie file (*.mpg *.mpeg)",
    "mov": "QuickTime (*.mov)",
    "gif": "Animated GIF (*.gif)",
}

#: ``file_dialogs.py:702-707`` — which encoder can write which container.
MOVIE_ENCODER_SUPPORT: Dict[str, Dict[str, int]] = {
    "": {"mp4": 0, "mpg": 0, "mov": 0, "gif": 0},
    "ffmpeg": {"mp4": 1, "mpg": 1, "mov": 1, "gif": 1},
    "mpeg_encode": {"mp4": 0, "mpg": 1, "mov": 0, "gif": 0},
    "convert": {"mp4": 0, "mpg": 0, "mov": 0, "gif": 1},
}

#: ``forms/png.ui`` ``input_rendering`` + ``file_dialogs.py:636-652``.
PNG_RENDERING_MODES: Sequence[str] = (
    "capture current display",
    "draw antialiased OpenGL image",
    "ray trace with opaque background",
    "ray trace with transparent background",
)

#: ``file_dialogs.py:304-313`` — (multiplex, discrete) per combo index.
MAE_MULTIPLEX_CHOICES: Sequence[Dict[str, Any]] = (
    {"label": "automatic handling", "multiplex": -2, "discrete": -1},
    {"label": "as one multi-state object (trajectory)", "multiplex": 0, "discrete": 0},
    {
        "label": "as one multi-state object (discrete states)",
        "multiplex": 0,
        "discrete": 1,
    },
    {"label": "as separate objects", "multiplex": 1, "discrete": -1},
)

#: ``pymol_qt_gui.py:643`` opens with NO filter (all files); this list is the
#: web picker's convenience filter set, built from what PyMOL can actually read.
LOAD_FILTERS: Sequence[str] = (
    "All Files (*)",
    "Structures (*.pdb *.cif *.mmcif *.bcif *.mmtf *.mol2 *.sdf *.mol *.xyz *.pqr *.ent)",
    "Sessions (*.pse *.psw *.pze *.pzw)",
    "Maps (*.ccp4 *.map *.mrc *.dx *.brix *.o *.omap *.dsn6)",
    "Trajectories (*.dcd *.dtr *.xtc *.trr *.crd *.trj *.nc)",
    "Alignments (*.aln *.fasta *.fa)",
    "Scripts (*.pml *.py *.pym)",
)


# --------------------------------------------------------------------------
# Formats the web client REFUSES on purpose (inventory row 298).
# --------------------------------------------------------------------------

#: MEASURED, not inferred.  ``packages/engine/testing/data``-free reproduction, run over the
#: real socket in ``packages/bridge/tests/test_wf_files.py``: a file containing the
#: single word ``delete`` was handed to ``cmd.load`` and **the file was gone
#: afterwards** — ``_processPWG`` ran ``os.unlink(fname)``
#: (``packages/engine/modules/pymol/importing.py:597-598``) and ``cmd.load`` returned ``-1``
#: without raising.  Nothing about ``.pwg`` is inert: the same parser can set a
#: listening port, add HTTP response headers, publish a document root,
#: ``__import__`` an arbitrary module name and call its ``__launch__``, open a
#: system web browser, ``urlretrieve`` a remote "report" URL with the port in
#: it, and finally start ``pymol.pymolhttpd.PymolHttpd`` — a SECOND HTTP server
#: inside the process the bridge is already serving from
#: (``importing.py:516-615``, ``pymolhttpd.py:441-520``).
PWG_REFUSAL = (
    "'.pwg' is refused by the web client. A .pwg file is a script that can open "
    "a listening port, add HTTP headers, publish a document root, import and "
    "run an arbitrary Python module, launch a web browser, report the port to a "
    "remote URL, delete itself, and start a second HTTP server inside this "
    "process (packages/engine/modules/pymol/importing.py:516-615). Run it from a desktop PyMOL "
    "if you trust it."
)

#: format (and extension) -> why the client must not load it.  Distinct from
#: ``incentive_only.UNAVAILABLE_FORMATS``, which is "this build cannot", not
#: "we decline".
REFUSED_FORMATS: Dict[str, str] = {"pwg": PWG_REFUSAL}


# --------------------------------------------------------------------------
# The legacy Tk map-generation dialog (inventory row 259).
# --------------------------------------------------------------------------

#: MEASURED on this tree, and the single most important fact about the whole
#: dialog: ``ExecutiveMapGenerate`` is compiled with ``NO_MMLIBS``
#: (``packages/engine/layer3/Executive.cpp:6929-6935``), so it prints " Error: MTZ map loading
#: not supported in this PyMOL build." and returns ``nullptr`` — always.
#:
#: The trap: ``cmd.map_generate`` **still returns the map name**
#: (``packages/engine/modules/pymol/creating.py:289`` is a bare ``return name``, reached on both
#: paths), so the return value is NOT a success signal.  ``PyMOLMapLoad.run``
#: tests exactly that value (``PyMOLMapLoad.py:288``, ``if r==None or r=="None"
#: or r==""``) and therefore goes on to build an isosurface/isomesh/volume on a
#: map object that was never created.  Anything porting this dialog must check
#: ``cmd.get_names()`` instead.
MAP_GENERATE_BUILD_NOTE = (
    "cmd.map_generate needs MMLIBS: packages/engine/layer3/Executive.cpp:6929-6935 compiles the "
    "generator out under NO_MMLIBS and prints 'Error: MTZ map loading not "
    "supported in this PyMOL build.'. cmd.map_generate nevertheless returns the "
    "map name on failure (creating.py:289), so the return value cannot be used "
    "as a success test -- check cmd.get_names()."
)

#: ``PyMOLMapLoad.py:260-266``, verbatim including the ``at\nleastone`` typo.
MISSING_AMPLITUDES_HELP = """
To synthesize a map from reflection data you need to specify at
leastone column for amplitudes and one column for phases. The
amplitudes column name was blank, and therefore PyMOL cannot create
the map.  Please select an amplitude column name from the file and try
again.
               """

#: ``PyMOLMapLoad.py:271-277``.
MISSING_PHASES_HELP = """
To synthesize a map from reflection data you need to specify at least
one column for amplitudes and one column for phases. The phases column
name was blank, and therefore PyMOL cannot create the map.  Please
select an amplitude column name from the file and try again.
               """

#: ``PyMOLMapLoad.__init__`` (``PyMOLMapLoad.py:28-33``) picks the header class
#: off the LAST THREE CHARACTERS of the name, case-sensitively per entry.
MAP_HEADER_CLASSES: Dict[str, str] = {
    "mtz": "MTZHeader",
    "cif": "CIFHeader",
    "cns": "CNSHeader",
    "hkl": "CNSHeader",
}


def non_mtz_refusal(filename: str) -> str:
    """Why a CIF/CNS/HKL reflection file cannot reach the map generator.

    ``PyMOLMapLoad`` offered all four formats and built a ``CIFHeader`` or a
    ``CNSHeader`` for three of them, but ``cmd.map_generate`` hard-codes
    ``headering.MTZHeader`` (``creating.py:234-236``, comment "TODO: work for
    CIF, MTZ, and CNS"), so the other three cannot work at all.

    Handing one to the generator anyway is not a clean failure: MTZHeader's
    parser unpacks a header offset from bytes 4-8 of the file and seeks there
    (``headering.py:261-302``), so a TEXT file comes back as, MEASURED on
    ``packages/engine/testing/data/1bna.cif``, ``"'<' not supported between instances of 'int'
    and 'NoneType'"`` — which tells the user nothing. Both the dialog's info
    call and its run call answer with this sentence instead.
    """
    return (
        "cmd.map_generate reads MTZ only (creating.py:234-236 'TODO: "
        "work for CIF, MTZ, and CNS'); %s is not an MTZ" % filename
    )


def map_generate_prefix(amplitudes: str, name_prefix: str = "") -> str:
    """``PyMOLMapLoad.run``'s prefix rule (``PyMOLMapLoad.py:245-254``).

    Blank "New Map Name Prefix" falls back to the *dataset* element of a fully
    qualified amplitudes column: ``crystal/dataset/COL`` -> ``dataset``
    (``split('/')[1]``, not the column name), and to the raw text when the
    column carries no ``/``.  ``cmd.get_unused_name`` is applied by the caller,
    because it takes the API lock.
    """
    if name_prefix:
        return name_prefix
    if "/" in amplitudes:
        parts = amplitudes.split("/")
        if len(parts) >= 2:
            return parts[1]
    return amplitudes


def map_rep_plan(rep: str, base: str, fofc: bool) -> List[Dict[str, Any]]:
    """The representation ``PyMOLMapLoad.run`` builds (``PyMOLMapLoad.py:295-331``).

    ``rep`` is ``default_fofc_map_rep`` or ``default_2fofc_map_rep`` (both
    default to ``volume``); ``base`` is the *unused* map name, which the Tk code
    uses for both the map argument and the suffix stem because
    ``cmd.map_generate`` handed it back.  Names carry a ``get_unused_name``
    marker rather than a resolved name so this stays pure.
    """
    if fofc:
        if rep == "isosurface":
            # NOTE: the FoFc isosurface branch is the ONE branch that never
            # colours its object (`:299-301`).
            return [{"op": "isosurface", "stem": base + "-srf", "level": 1.0,
                     "color": None}]
        if rep == "isomesh":
            return [
                {"op": "isomesh", "stem": base + "-msh3", "level": 3.0,
                 "color": "green"},
                {"op": "isomesh", "stem": base + "-msh-3", "level": -3.0,
                 "color": "red"},
            ]
        return [{"op": "volume", "stem": base + "-vol", "ramp": "fofc",
                 "color": None}]
    if rep == "isosurface":
        return [{"op": "isosurface", "stem": base + "-srf", "level": 1.0,
                 "color": "blue"}]
    if rep == "isomesh":
        return [{"op": "isomesh", "stem": base + "-msh", "level": 1.0,
                 "color": "blue"}]
    return [{"op": "volume", "stem": base + "-vol", "ramp": "2fofc",
             "color": None}]


# --------------------------------------------------------------------------
# macOS Finder "Open With" (inventory row 293).
# --------------------------------------------------------------------------

#: ``PyMOLApplication.handle_file_open_active`` (``pymol_qt_gui.py:1152-1157``)
#: — the four things a ``.psw`` drop does before ``load_dialog``.
#:
#: MEASURED: step four cannot succeed anywhere.  ``CmdFullScreen``
#: (``packages/engine/layer4/Cmd.cpp:5352-5362``) declares ``int ok = false``, never assigns it,
#: and returns ``APIResultOk(G, ok)`` — which raises ``CmdException`` on false.
#: ``cmd.full_screen('on')`` therefore ALWAYS raises, in this build and in the
#: Qt build, after ``ExecutiveFullScreen`` has already run.  Observed over the
#: socket: ``CmdException: ' Error: '`` from ``viewing.py:1356``.
PSW_PRESET_STEPS: Sequence[Dict[str, Any]] = (
    {"kind": "set", "name": "presentation", "value": 1},
    {"kind": "set", "name": "internal_gui", "value": 0},
    {"kind": "set", "name": "internal_feedback", "value": 0},
    {"kind": "full_screen", "name": "full_screen", "value": "on"},
)


def _re_ext_from_filter(filter_text: str) -> Optional[str]:
    """``getSaveFileNameWithExt``'s regex (``pymol/Qt/utils.py:240-244``)."""
    match = re.search(r"\*(\.[\w\.]+)", filter_text or "")
    return match.group(1) if match else None


def with_extension(fname: str, filter_text: str) -> str:
    """``getSaveFileNameWithExt`` (``packages/engine/modules/pymol/Qt/utils.py:229-246``).

    "if the typed basename has no ``.``, append the first ``*.ext`` from the
    selected filter".  Reproduced exactly, including the ``os.path.split``
    (basename-only) test — ``/a.b/name`` gains the extension.
    """
    if not fname:
        return ""
    if "." not in os.path.split(fname)[-1]:
        ext = _re_ext_from_filter(filter_text)
        if ext:
            fname += ext
    return fname


def _cms_traj_file(fname: str) -> Optional[str]:
    """``_get_cms_traj_file`` (``file_dialogs.py:12-30``), verbatim."""
    stem = fname[:-8] if fname.endswith("-out.cms") else fname[:-4]
    candidates = [(stem + "_trj", "clickme.dtr"), (stem + ".xtc",)]
    for components in candidates:
        traj = os.path.join(*components)
        if os.path.exists(traj):
            return traj
    return None


def pymol_started() -> bool:
    """Has ``SingletonPyMOL.start()`` run in this process?

    MEASURED LANDMINE, do not remove: calling ANY lock-taking ``cmd`` API
    before the engine starts (``cmd.get_legal_name`` is the one this module
    would reach through ``filename_to_objectname``) leaves ``cmd._COb`` holding
    a NULL capsule.  ``SingletonPyMOL.start()`` then refuses with
    ``RuntimeError: can only start SingletonPyMOL once``
    (``packages/engine/modules/pymol2/__init__.py:53-55``), the bridge comes up DEGRADED and
    every later call hangs or errors — from one string helper called too early.
    ``filename_to_format`` itself is pure string work and is always safe.
    """
    try:
        import pymol

        return getattr(pymol.cmd, "_COb", None) is not None
    except Exception:  # noqa: BLE001
        return False


def classify_filename(fname: str) -> Dict[str, Any]:
    """The ``load_dialog`` dispatch decision (``file_dialogs.py:33-77``).

    Returns the branch the Qt front-end would take, so React can open the same
    modal.  ``dialog`` is one of ``traj|aln|mae|map|mtz|session|script|plain``.
    """
    from pymol import importing

    from ..incentive_only import UNAVAILABLE_FORMATS

    prefix, ext, fmt, zipped = importing.filename_to_format(fname)
    is_url = "://" in fname

    info: Dict[str, Any] = {
        "filename": fname,
        "prefix": prefix,
        "ext": ext,
        "format": fmt,
        "zipped": zipped,
        "isUrl": is_url,
        # `filename_to_objectname` == prefix through `cmd.get_legal_name`,
        # which takes the API lock: see `pymol_started`.
        "objectName": (
            importing.filename_to_objectname(fname) if pymol_started() else prefix
        ),
        "dialog": "plain",
        "mapType": None,
        "alnFormat": None,
        "cmsTraj": None,
        "unavailable": None,
        # Row 298: refused BY POLICY, which is a different thing from
        # `unavailable` ("this build cannot"). The client must check both.
        "refused": None,
    }

    # `file_dialogs.py:46` tests the last four characters, NOT the parsed
    # format: a ".dcd" is a trajectory even though filename_to_format has no
    # opinion about it.
    if fname[-4:] in (".dcd", ".dtr", ".xtc", ".trr"):
        info["dialog"] = "traj"
    elif fmt in ("aln", "fasta"):
        info["dialog"] = "aln"
        info["alnFormat"] = fmt
    elif fmt == "mae":
        info["dialog"] = "mae"
    elif fmt in ("ccp4", "map"):
        info["dialog"] = "map"
        info["mapType"] = "ccp4"
    elif fmt == "brix":
        info["dialog"] = "map"
        info["mapType"] = "o"
    elif fmt == "mtz":
        info["dialog"] = "mtz"
    elif fmt in ("pse", "psw"):
        info["dialog"] = "session"
    elif fmt in ("pml", "py", "pym"):
        info["dialog"] = "script"

    if fname.endswith(".cms"):
        info["cmsTraj"] = _cms_traj_file(fname)

    # Row 298. Keyed on BOTH the parsed format and the raw extension: a URL
    # (`http://host/app.pwg`) parses the same way, and `filename_to_format`
    # lower-cases neither consistently across the zipped branch.
    info["refused"] = REFUSED_FORMATS.get(fmt) or REFUSED_FORMATS.get(
        (ext or "").lower()
    )

    # Honest about the formats that raise in this open-source build
    # (`incentive_only.py`): mae, mtz, stl, gltf/glb.
    dotted = "." + (ext or "")
    if dotted in UNAVAILABLE_FORMATS:
        info["unavailable"] = UNAVAILABLE_FORMATS[dotted]
    elif fmt and ("." + fmt) in UNAVAILABLE_FORMATS:
        info["unavailable"] = UNAVAILABLE_FORMATS["." + fmt]
    elif _is_sentinel_loader(fmt):
        info["unavailable"] = (
            "'%s' format is Incentive-only and raises in this build" % fmt
        )
    return info


def _is_sentinel_loader(fmt: str) -> bool:
    """Is this format registered to `incentive_format_not_available_func`?

    This used to be the literal tuple ``("vis", "moe", "phypo")``. The four
    sentinel entries (`mae` as well) share ONE function object
    (`importing.py:1620,1641-1643`), so identity answers the question exactly
    and cannot drift the way a copied name list does — upstream adds and
    removes Incentive formats between releases, and a stale list here silently
    offers a loader that raises.
    """
    if not fmt:
        return False
    try:
        from pymol import importing
    except Exception:  # noqa: BLE001 - no PyMOL: nothing is a sentinel
        return False
    sentinel = getattr(importing, "incentive_format_not_available_func", None)
    if sentinel is None:
        return False
    return importing.loadfunctions.get(fmt) is sentinel


class _RecentDB:
    """PyMOL's own recent-files code, borrowed rather than reimplemented.

    ``PyMOLDesktopGUI._recent_filenames_lazy_init`` / ``recent_filenames`` /
    ``recent_filenames_add`` (``packages/engine/modules/pymol/_gui.py:975-1032``) only touch
    ``self._recent_filenames_db``, so binding the *unbound* functions onto a
    bare holder gives byte-identical behaviour against the same
    ``~/.pymol/recent.db``: same schema, same ``REPLACE INTO``, same prune to
    15 rows once the table passes 20.
    """

    _recent_filenames_db: Any = None
    _bound = False

    @classmethod
    def _bind(cls) -> None:
        """Copy the three unbound members onto this class, once.

        They call each other through ``self`` (``recent_filenames_add`` calls
        ``self._recent_filenames_lazy_init``), so they must be real class
        attributes, not instance-bound copies.
        """
        if cls._bound:
            return
        from pymol._gui import PyMOLDesktopGUI

        cls._recent_filenames_lazy_init = (  # type: ignore[attr-defined]
            PyMOLDesktopGUI._recent_filenames_lazy_init
        )
        cls.recent_filenames = PyMOLDesktopGUI.recent_filenames  # type: ignore[attr-defined]
        cls.recent_filenames_add = (  # type: ignore[attr-defined]
            PyMOLDesktopGUI.recent_filenames_add
        )
        cls._bound = True

    def __init__(self) -> None:
        self._bind()

    def list(self) -> List[str]:
        return list(self.recent_filenames)  # type: ignore[attr-defined]

    def add(self, filename: str) -> None:
        self.recent_filenames_add(filename)  # type: ignore[attr-defined]


# --------------------------------------------------------------------------
# Blocking plugin file dialogs (inventory row 295).
# --------------------------------------------------------------------------


def engine_thread() -> Optional[int]:
    """The thread ident of PyMOL's draw pump, or ``None``.

    ``EngineState`` publishes it as ``pymol.glutThread``
    (``packages/bridge/tenmol_bridge/engine.py:170``), which is also where a desktop
    PyMOL puts its GLUT thread — so this works without importing any bridge
    internals and without a circular import.  MEASURED: over the socket,
    ``pymol.glutThread`` and ``threading.get_ident()`` inside a ``{t:'do'}``
    are the same number, confirming the dispatcher runs on that thread.
    """
    try:
        import pymol

        ident = getattr(pymol, "glutThread", None)
        return int(ident) if ident else None
    except Exception:  # noqa: BLE001
        return None


class _Cancelled:
    """Sentinel: the user dismissed the dialog (tkinter's ``''`` / ``None``)."""

    def __repr__(self) -> str:  # pragma: no cover - debugging aid
        return "<cancelled>"


CANCELLED = _Cancelled()


class DialogBroker:
    """A blocking Python dialog, answered by the browser.

    WHY THIS IS A POLL AND NOT A PUSH.  ``packages/protocol/src/topics/dialog.ts``
    describes a ``dialog`` topic whose answer arrives as
    ``{t:'call', fn:'_bridge.answer_dialog'}``.  ``_bridge.*`` is routed inside
    ``server.py`` and the topic would have to be emitted through
    ``BridgeServer._emit_topic`` — both frozen files this work package must not
    edit.  So the rendezvous is inverted: the blocked thread parks a request
    here, the client picks it up with ``dialog_pending`` and posts the answer
    with ``dialog_answer``.  Same shape, same blocking semantics, no shared file
    touched.  Making it a push is a one-line change in each frozen file and is
    reported rather than applied.

    THE HARD RULE (plan §6 WP-18), enforced with an exception rather than a
    comment: **the request must never be made from the engine thread.**  The
    dispatcher submits ``cmd`` calls to the draw pump, so a plugin that called
    ``askopenfilename`` from there would stop the 60 Hz pump — the viewport
    would freeze, and the very dialog it is waiting for could never be drawn or
    answered, because answering also goes through the pump.  That is a deadlock,
    not a slow dialog, so it is refused up front with a message that says what
    to do instead.
    """

    #: How long a blocked plugin thread waits before it gives up and behaves as
    #: if the user pressed Cancel.  Generous: a person is choosing a file.
    DEFAULT_TIMEOUT = 300.0

    def __init__(self) -> None:
        self._cv = threading.Condition(threading.Lock())
        self._next_id = 1
        self._open: Dict[int, Dict[str, Any]] = {}
        self._answers: Dict[int, Any] = {}
        self._log: List[Dict[str, Any]] = []

    # -- the blocked side ---------------------------------------------------

    def ask(
        self, kind: str, options: Dict[str, Any], timeout: Optional[float] = None
    ) -> Any:
        """Block this thread until the browser answers.  Returns :data:`CANCELLED`."""
        ident = engine_thread()
        if ident is not None and threading.get_ident() == ident:
            raise RuntimeError(
                "tenmol: a blocking file dialog (%s) was requested from PyMOL's "
                "engine thread, which also runs the draw pump -- blocking it "
                "would freeze the viewport AND the dialog that is supposed to "
                "answer it. Run the plugin's dialog from a worker thread "
                "(threading.Thread(target=...).start()), which is what the Qt "
                "front-end effectively does by running its event loop "
                "elsewhere." % kind
            )

        limit = self.DEFAULT_TIMEOUT if timeout is None else float(timeout)
        with self._cv:
            dialog_id = self._next_id
            self._next_id += 1
            request = {
                "dialogId": dialog_id,
                "kind": kind,
                "options": dict(options),
                "created": time.time(),
            }
            self._open[dialog_id] = request
            self._log.append({"dialogId": dialog_id, "kind": kind, "state": "open"})
            del self._log[:-64]
            self._cv.notify_all()

            deadline = time.monotonic() + limit
            while dialog_id not in self._answers:
                remaining = deadline - time.monotonic()
                if remaining <= 0:
                    self._open.pop(dialog_id, None)
                    self._log.append(
                        {"dialogId": dialog_id, "kind": kind, "state": "timeout"}
                    )
                    print(
                        " tenmol: no answer to file dialog %d (%s) after %.0fs; "
                        "treating it as Cancel" % (dialog_id, kind, limit)
                    )
                    return CANCELLED
                self._cv.wait(remaining)
            answer = self._answers.pop(dialog_id)
            self._open.pop(dialog_id, None)
        return CANCELLED if answer is None else answer

    # -- the client side (all non-blocking, all engine-thread safe) ---------

    def pending(self) -> List[Dict[str, Any]]:
        with self._cv:
            return [
                {
                    "dialogId": req["dialogId"],
                    "kind": req["kind"],
                    "options": dict(req["options"]),
                    "waitingFor": round(time.time() - req["created"], 3),
                }
                for req in sorted(self._open.values(), key=lambda r: r["dialogId"])
            ]

    def answer(self, dialog_id: int, value: Any) -> Dict[str, Any]:
        dialog_id = int(dialog_id)
        with self._cv:
            if dialog_id not in self._open:
                return {"answered": False, "error": "no open dialog %d" % dialog_id}
            self._answers[dialog_id] = value
            self._log.append({"dialogId": dialog_id, "state": "answered"})
            del self._log[:-64]
            self._cv.notify_all()
        return {"answered": True, "error": None}

    def cancel(self, dialog_id: int) -> Dict[str, Any]:
        return self.answer(dialog_id, None)

    def history(self) -> List[Dict[str, Any]]:
        with self._cv:
            return list(self._log)


class BridgeFileDialog:
    """``_qtFileDialog`` (``packages/engine/modules/pmg_qt/mimic_tk.py:36-90``), web edition.

    Same seven entry points, same argument names, same **return shapes** —
    ``str``, ``list[str]``, an open file object, a list of open file objects,
    ``None`` — because every legacy plugin's Open/Save is written against
    ``tkFileDialog`` and does ``if not filename: return`` or ``for line in
    handle``.  Anything else and the plugins break silently.

    The only behavioural difference is where the picker is drawn: Qt calls
    ``QFileDialog.getOpenFileName`` (native, blocking), we park a request on a
    :class:`DialogBroker` and block on the same thread until React answers.
    """

    def __init__(self, broker: DialogBroker) -> None:
        self._broker = broker

    # -- filter translation, byte-identical to mimic_tk --------------------

    @staticmethod
    def _getfilter(filetypes: Any) -> str:
        """``_qtFileDialog._getfilter`` (``mimic_tk.py:37-48``), verbatim.

        tkinter's ``filetypes`` is ``[(label, '.ext'), ...]``; repeated labels
        accumulate their extensions and the result is Qt's ``';;'``-joined
        filter string.  Kept because the *filter string* is what the picker
        shows and what ``getSaveFileNameWithExt`` parses.
        """
        import collections

        extensions: Dict[str, List[str]] = collections.defaultdict(list)
        names: List[str] = []
        for name, ext in filetypes or ():
            if ext.startswith("."):
                ext = "*" + ext
            extensions[name].append(ext)
            if name not in names:
                names.append(name)
        return ";;".join(
            "%s (%s)" % (name, " ".join(extensions[name])) for name in names
        )

    def _payload(self, options: Dict[str, Any], multiple: bool) -> Dict[str, Any]:
        joined = self._getfilter(options.get("filetypes", ""))
        return {
            "title": options.get("title", ""),
            "initialdir": options.get("initialdir", ""),
            "initialfile": options.get("initialfile", ""),
            # `filter` is exactly what Qt would have been handed; `filters` is
            # the same thing split, because the React picker takes a list.
            "filter": joined,
            "filters": [part for part in joined.split(";;") if part],
            "multiple": bool(multiple),
        }

    # -- the seven tkFileDialog entry points -------------------------------

    def askopenfilename(self, **options: Any) -> Any:
        multiple = bool(options.get("multiple"))
        answer = self._broker.ask(
            "askopenfilenames" if multiple else "askopenfilename",
            self._payload(options, multiple),
        )
        if answer is CANCELLED:
            return [] if multiple else ""
        if multiple:
            return [str(item) for item in answer] if isinstance(answer, list) else [
                str(answer)
            ]
        return str(answer[0]) if isinstance(answer, list) else str(answer)

    def askopenfilenames(self, **options: Any) -> List[str]:
        options["multiple"] = 1
        return self.askopenfilename(**options)

    def askopenfile(self, mode: str = "r", **options: Any) -> Any:
        r = self.askopenfilename(**options)
        if options.get("multiple"):
            return [open(f, mode) for f in r]
        if not r:
            return None
        return open(r, mode)

    def askopenfiles(self, mode: str = "r", **options: Any) -> Any:
        options["multiple"] = 1
        return self.askopenfile(mode, **options)

    def asksaveasfilename(self, **options: Any) -> str:
        answer = self._broker.ask("asksaveasfilename", self._payload(options, False))
        if answer is CANCELLED:
            return ""
        return str(answer[0]) if isinstance(answer, list) else str(answer)

    def asksaveasfile(self, mode: str = "w", **options: Any) -> Any:
        r = self.asksaveasfilename(**options)
        if not r:
            return None
        return open(r, mode)

    def askdirectory(self, **options: Any) -> str:
        answer = self._broker.ask("askdirectory", self._payload(options, False))
        if answer is CANCELLED:
            return ""
        return str(answer[0]) if isinstance(answer, list) else str(answer)


class _TkFileDialogFinder:
    """``MimicTkImporter`` (``mimic_tk.py:110-127``) for one module name.

    ``sys.modules['tkinter.filedialog'] = obj`` alone is not enough — ``import
    tkinter.filedialog`` resolves the attribute on the parent package, which is
    why upstream uses a ``meta_path`` hook.  Same trick, one entry, removable.
    """

    def __init__(self, module: Any) -> None:
        self.module = module
        self.names = ("tkinter.filedialog", "tkFileDialog")

    def find_spec(self, fullname: str, path: Any = None, target: Any = None) -> Any:
        if fullname in self.names:
            from importlib.machinery import ModuleSpec

            return ModuleSpec(fullname, self)
        return None

    def create_module(self, spec: Any) -> Any:
        return self.module

    def exec_module(self, module: Any) -> None:
        return None

    def load_module(self, fullname: str) -> Any:  # pragma: no cover - legacy path
        sys.modules[fullname] = self.module
        return self.module


_TK_STATE: Dict[str, Any] = {"shim": None, "saved": {}, "finder": None,
                             "had_attr": False, "saved_attr": None}


def install_tk_filedialog(broker: DialogBroker) -> Dict[str, Any]:
    """Put :class:`BridgeFileDialog` where every legacy plugin looks for it.

    Idempotent, and reversible — which matters more here than usual, because
    ``sys.modules`` and ``sys.meta_path`` are process-global and this process is
    shared by everything else in the bridge.
    """
    if _TK_STATE["shim"] is not None:
        return {"installed": True, "already": True}

    shim = BridgeFileDialog(broker)
    saved = {name: sys.modules.get(name) for name in
             ("tkFileDialog", "tkinter.filedialog")}

    # `tkFileDialog` has no parent package, so seeding sys.modules is both
    # sufficient and immediate -- and it is the name the Python-2-era plugins
    # still use, which is why mimic_tk seeds it too (`mimic_tk.py:98-99`).
    sys.modules["tkFileDialog"] = shim

    # `tkinter.filedialog` is NOT seeded unless the real module is already
    # loaded.  MEASURED: pre-filling `sys.modules['tkinter.filedialog']`
    # short-circuits the import machinery, which then never sets the submodule
    # as an ATTRIBUTE of the package -- so `import tkinter.filedialog` raised
    # "AttributeError: module 'tkinter' has no attribute 'filedialog'".  Left
    # empty, the import runs the meta_path finder below, and `_bootstrap._load`
    # does the `setattr(parent, child, module)` for us.  This is the same reason
    # mimic_tk needs a meta_path hook at all (`mimic_tk.py:101-104`).
    if saved["tkinter.filedialog"] is not None:
        sys.modules["tkinter.filedialog"] = shim

    tk = sys.modules.get("tkinter")
    had_attr = tk is not None and hasattr(tk, "filedialog")
    saved_attr = getattr(tk, "filedialog", None) if tk is not None else None
    if tk is not None:
        setattr(tk, "filedialog", shim)

    finder = _TkFileDialogFinder(shim)
    sys.meta_path.insert(0, finder)

    _TK_STATE.update(
        {"shim": shim, "saved": saved, "finder": finder,
         "had_attr": had_attr, "saved_attr": saved_attr}
    )
    return {"installed": True, "already": False}


def uninstall_tk_filedialog() -> bool:
    if _TK_STATE["shim"] is None:
        return False
    finder = _TK_STATE["finder"]
    if finder in sys.meta_path:
        sys.meta_path.remove(finder)
    for name, saved in (_TK_STATE["saved"] or {}).items():
        if saved is None:
            sys.modules.pop(name, None)
        else:
            sys.modules[name] = saved
    tk = sys.modules.get("tkinter")
    if tk is not None:
        if _TK_STATE["had_attr"]:
            setattr(tk, "filedialog", _TK_STATE["saved_attr"])
        else:
            try:
                delattr(tk, "filedialog")
            except AttributeError:
                pass
    _TK_STATE.update({"shim": None, "saved": {}, "finder": None,
                      "had_attr": False, "saved_attr": None})
    return True


def tk_filedialog_installed() -> bool:
    return _TK_STATE["shim"] is not None


class FilesAPI:
    """The ``cmd.tenmol_files`` namespace.

    Every method returns JSON-safe values only (the bridge codec refuses
    anything else rather than ``repr()``-ing it — ``tenmol_bridge/codec.py``).
    """

    #: Cap on :meth:`download`; a .pse or a CCP4 map can be hundreds of MB and
    #: the WebSocket text channel is the wrong pipe for that.
    MAX_DOWNLOAD_BYTES = 32 * 1024 * 1024

    def __init__(self, cmd: Any = None) -> None:
        if cmd is None:
            import pymol

            cmd = pymol.cmd
        self.cmd = cmd
        self._initialdir: Optional[str] = None
        self._recent = _RecentDB()
        self._pdbe: Dict[str, Dict[str, Any]] = {}
        self._pdbe_lock = threading.Lock()
        #: Row 295 — the rendezvous every blocking plugin dialog parks on.
        self.broker = DialogBroker()

    # ------------------------------------------------------------ meta

    def hello(self) -> Dict[str, Any]:
        """One round trip that tells React everything static about area 6."""
        return {
            "installed": True,
            "cwd": self.pwd(),
            "home": os.path.expanduser("~"),
            "sep": os.sep,
            "initialdir": self.initialdir(),
            "filters": {
                "load": list(LOAD_FILTERS),
                "saveMolecule": list(SAVE_MOLECULE_FILTERS),
                "session": list(SESSION_FILTERS),
                "log": list(LOG_FILTERS),
                "run": list(RUN_FILTERS),
                "movie": dict(MOVIE_FILTERS),
                "map": ["CCP4 (*.ccp4 *.map)"],
                "alignment": ["clustalw (*.aln)"],
                "png": ["PNG File (*.png)"],
            },
            "geometryExports": [dict(item) for item in GEOMETRY_EXPORTS],
            "pngRenderingModes": list(PNG_RENDERING_MODES),
            "maeMultiplex": [dict(item) for item in MAE_MULTIPLEX_CHOICES],
            "encoderSupport": {k: dict(v) for k, v in MOVIE_ENCODER_SUPPORT.items()},
            "encoders": self.encoders(),
            "unavailable": self.unavailable(),
            "refused": self.refused(),
            "loadFormats": self.load_formats(),
            "saveFormats": self.save_formats(),
        }

    def unavailable(self) -> Dict[str, str]:
        """Extensions that raise in this build (``incentive_only.py``)."""
        from ..incentive_only import UNAVAILABLE_FORMATS

        return dict(UNAVAILABLE_FORMATS)

    def refused(self) -> Dict[str, str]:
        """Formats the client declines to load at all (row 298)."""
        return dict(REFUSED_FORMATS)

    def load_formats(self) -> List[str]:
        """``importing.loadfunctions`` keys — the python-handled loaders."""
        from pymol import importing

        return sorted(importing.loadfunctions)

    def load_capabilities(self) -> List[Dict[str, Any]]:
        """Which `loadfunctions` formats actually work in THIS build.

        `load_formats` returns the raw key set, and that list lies: `mae`,
        `vis`, `moe` and `phypo` are registered to
        `incentive_format_not_available_func`, and `mtz` and `stl` raise
        `IncentiveOnlyException` from inside their own bodies. A picker built
        from the raw keys offers six formats that cannot load anything.

        Two signals, because one is not enough:

        * **Handler identity.** The four sentinel entries share one function
          object (`importing.py:1620,1641-1643`), so they are detectable
          exactly, with no name list to keep in step with upstream.
        * **A measured table.** `mtz` and `stl` are ordinary handlers that
          raise once called, which nothing static can see; they come from
          `incentive_only.UNAVAILABLE_FORMATS`, which was populated by running
          them.

        Measured on this build: `dae` IS available (it reached "failed to open
        file", i.e. the loader ran and only disliked the path), and `cml` and
        `pdbml` load valid files correctly.
        """
        from pymol import importing

        from ..incentive_only import UNAVAILABLE_FORMATS

        sentinel = getattr(importing, "incentive_format_not_available_func", None)
        blocked = {
            key.lstrip("."): reason for key, reason in UNAVAILABLE_FORMATS.items()
        }

        out: List[Dict[str, Any]] = []
        for fmt in sorted(importing.loadfunctions):
            handler = importing.loadfunctions[fmt]
            if sentinel is not None and handler is sentinel:
                out.append(
                    {
                        "format": fmt,
                        "available": False,
                        "reason": "'%s' format not supported by this PyMOL build" % fmt,
                    }
                )
            elif fmt in blocked:
                out.append(
                    {"format": fmt, "available": False, "reason": blocked[fmt]}
                )
            else:
                out.append({"format": fmt, "available": True, "reason": None})
        return out

    def save_formats(self) -> List[str]:
        """``exporting.savefunctions`` keys, plus the ``func_type4`` set.

        ``func_type4`` (``exporting.py:853-857``) is ``{mmod, pkl, pkla}``.
        ``mmod`` used to be MISSING from this list while its three aliases
        ``mmd``/``out``/``dat`` (``importing.py:67-68`` maps all three to
        format ``mmod``) were present -- so ``x.mmod``, which ``cmd.save``
        writes perfectly well (measured: 3175 bytes of MacroModel for a trp
        fragment) and which ``save_check`` already calls ``recognised``, was
        the one saveable extension the manifest denied.
        """
        from pymol import exporting

        extra = ["mmod", "mmd", "out", "dat", "pkl", "pkla"]
        return sorted(set(list(exporting.savefunctions) + extra))

    # ------------------------------------------------------------ paths

    def expand(self, path: str) -> str:
        """``cmd.exp_path`` — ``~`` and ``$VAR`` expansion (``cmd.py:112``)."""
        if not path:
            return ""
        try:
            return self.cmd.exp_path(path)
        except Exception:  # noqa: BLE001 - never lose the user's typing
            return os.path.expanduser(os.path.expandvars(path))

    def pwd(self) -> str:
        """The PyMOL process working directory (``externing.py:56``)."""
        return os.getcwd()

    def home(self) -> str:
        return os.path.expanduser("~")

    def initialdir(self) -> str:
        """``PyMOLQtGUI.initialdir`` (``pymol_qt_gui.py:496-506``).

        "``_initialdir`` or ``os.getcwd()``" — sticky across dialogs, seeded
        from the cwd until the first browse.
        """
        return self._initialdir or os.getcwd()

    def set_initialdir(self, path: str) -> Dict[str, str]:
        """The setter half; every dialog writes ``os.path.dirname(chosen)``."""
        expanded = self.expand(path)
        if expanded and not os.path.isdir(expanded):
            expanded = os.path.dirname(expanded)
        if expanded:
            self._initialdir = expanded
        return {"initialdir": self.initialdir()}

    def chdir(self, path: str = ".") -> Dict[str, str]:
        """File ▸ Working Directory ▸ Change (``pymol_qt_gui.py:870-873``).

        ``cmd.cd(dname or '.', quiet=0)`` — quiet=0 so the console shows it,
        exactly like the Qt dialog.
        """
        target = path or "."
        self.cmd.cd(target, quiet=0)
        self._initialdir = os.getcwd()
        return {"cwd": os.getcwd(), "initialdir": self.initialdir()}

    def browse(
        self,
        path: str = "",
        show_hidden: bool = False,
        dirs_only: bool = False,
        patterns: Optional[Sequence[str]] = None,
    ) -> Dict[str, Any]:
        """One directory listing for the React picker.

        ``patterns`` are shell globs taken from a Qt-style filter string
        (``*.pdb *.cif``); matching is case-insensitive because the Qt dialog
        is on macOS/Windows too.
        """
        target = self.expand(path) or self.initialdir()
        target = os.path.abspath(target)
        if os.path.isfile(target):
            target = os.path.dirname(target)

        result: Dict[str, Any] = {
            "path": target,
            "parent": os.path.dirname(target) if target != os.path.dirname(target) else None,
            "cwd": os.getcwd(),
            "home": os.path.expanduser("~"),
            "entries": [],
            "error": None,
            "truncated": False,
        }
        try:
            names = os.listdir(target)
        except OSError as exc:
            result["error"] = str(exc)
            return result

        globs = [p for p in (patterns or []) if p and p != "*"]
        entries: List[Dict[str, Any]] = []
        for name in names:
            if not show_hidden and name.startswith("."):
                continue
            full = os.path.join(target, name)
            try:
                is_dir = os.path.isdir(full)
            except OSError:
                continue
            if dirs_only and not is_dir:
                continue
            if globs and not is_dir and not _matches(name, globs):
                continue
            entries.append(_entry(full, name, is_dir))

        entries.sort(key=lambda e: (not e["isDir"], e["name"].lower()))
        if len(entries) > 4000:
            entries = entries[:4000]
            result["truncated"] = True
        result["entries"] = entries
        return result

    def stat(self, path: str) -> Dict[str, Any]:
        full = self.expand(path)
        out: Dict[str, Any] = {
            "path": full,
            "exists": False,
            "isDir": False,
            "isFile": False,
            "size": 0,
            "mtime": 0.0,
            "writable": False,
        }
        if not full:
            return out
        try:
            st = os.stat(full)
        except OSError:
            parent = os.path.dirname(full) or "."
            out["writable"] = os.access(parent, os.W_OK)
            return out
        out.update(
            {
                "exists": True,
                "isDir": os.path.isdir(full),
                "isFile": os.path.isfile(full),
                "size": int(st.st_size),
                "mtime": float(st.st_mtime),
                "writable": os.access(full, os.W_OK),
            }
        )
        return out

    def mkdir(self, path: str) -> Dict[str, Any]:
        full = self.expand(path)
        try:
            os.makedirs(full)
        except OSError as exc:
            return {"path": full, "created": False, "error": str(exc)}
        return {"path": full, "created": True, "error": None}

    def glob_paths(self, pattern: str) -> List[str]:
        """Server-side glob — what ``cmd.loadall`` expands (``importing.py:1513``)."""
        return sorted(_glob.glob(self.expand(pattern)))

    def places(self) -> List[Dict[str, str]]:
        """Sidebar shortcuts for the picker."""
        out = [
            {"label": "Working directory", "path": os.getcwd()},
            {"label": "Home", "path": os.path.expanduser("~")},
        ]
        fetch_path = self.fetch_info().get("fetchPath")
        if isinstance(fetch_path, str) and fetch_path:
            out.append({"label": "fetch_path", "path": fetch_path})
        for name in ("Desktop", "Documents", "Downloads"):
            candidate = os.path.join(os.path.expanduser("~"), name)
            if os.path.isdir(candidate):
                out.append({"label": name, "path": candidate})
        out.append({"label": "/", "path": os.sep})
        seen = set()
        unique = []
        for item in out:
            if item["path"] in seen:
                continue
            seen.add(item["path"])
            unique.append(item)
        return unique

    # ------------------------------------------------------------ recent

    def recent(self, limit: int = 20) -> List[Dict[str, Any]]:
        """``~/.pymol/recent.db``, newest first (``_gui.py:1008-1014``).

        ``display`` reproduces the Qt menu's truncation rule
        (``pymol_qt_gui.py:367-375``): names of 128 characters or more show as
        ``'...' + fname[-120:]``.
        """
        try:
            names = self._recent.list()
        except Exception as exc:  # noqa: BLE001
            return [{"path": "", "display": "", "error": str(exc)}]
        out = []
        for name in names[: max(0, limit)]:
            display = ("..." + name[-120:]) if len(name) >= 128 else name
            out.append({"path": name, "display": display, "exists": os.path.exists(name)})
        return out

    def recent_add(self, filename: str) -> Dict[str, Any]:
        try:
            self._recent.add(filename)
        except Exception as exc:  # noqa: BLE001
            return {"added": False, "error": str(exc)}
        return {"added": True, "error": None}

    # ------------------------------------------------------------ loading

    def classify(self, filename: str) -> Dict[str, Any]:
        return classify_filename(filename)

    def note_open(self, filename: str) -> Dict[str, Any]:
        """``load_dialog``'s first two statements (``file_dialogs.py:39-42``).

        Sets ``initialdir`` to the file's directory — *unless* the name is a
        URL, which deliberately does not move it — and registers the name in
        the recent-files history.
        """
        if "://" not in filename:
            self._initialdir = os.path.dirname(filename)
        self.recent_add(filename)
        return {"initialdir": self.initialdir()}

    def plan_open(self, paths: Sequence[str]) -> Dict[str, Any]:
        """``file_open`` (``pymol_qt_gui.py:643-649``) as data.

        The first file loads with ``partial=0`` and every subsequent one with
        ``partial=1``; the Qt loop also breaks as soon as ``load_dialog``
        returns falsy, which the client reproduces by stopping at the first
        step the user cancels.
        """
        steps = []
        for index, name in enumerate(paths or ()):
            info = classify_filename(name)
            info["partial"] = 0 if index == 0 else 1
            steps.append(info)
        return {"steps": steps, "count": len(steps)}

    def ask_partial_needed(self) -> Dict[str, Any]:
        """``ask_partial``'s skip test (``file_dialogs.py:81-82``).

        The prompt is skipped when ``partial`` is already set or the session is
        empty; ``auto_rename_duplicate_objects`` seeds the checkbox
        (``:84-85``).
        """
        names = self.cmd.get_names()
        return {
            "needed": bool(names),
            "names": list(names),
            "autoRenameDuplicates": bool(
                self.cmd.get_setting_boolean("auto_rename_duplicate_objects")
            ),
        }

    def traj_dialog_info(self) -> Dict[str, Any]:
        """``load_traj_dialog`` (``file_dialogs.py:102-149``).

        The guard first: with no molecular object the Qt dialog refuses with
        "To load a trajectory, you first need to load a molecular object".
        """
        names = list(self.cmd.get_object_list() or [])
        return {
            "objects": names,
            "ok": bool(names),
            "message": (
                ""
                if names
                else "To load a trajectory, you first need to load a molecular object"
            ),
        }

    def map_dialog_info(self, filename: str, map_type: str = "ccp4") -> Dict[str, Any]:
        """``load_map_dialog`` (``file_dialogs.py:336-406``)."""
        from pymol import importing

        setting = "normalize_" + map_type + "_maps"
        return {
            "objectName": importing.filename_to_objectname(filename),
            "normalizeSetting": setting,
            "normalize": bool(self.cmd.get_setting_int(setting) > 0),
        }

    def aln_dialog_info(self, filename: str, fmt: str = "aln") -> Dict[str, Any]:
        """``load_aln_dialog`` (``file_dialogs.py:204-282``).

        Same three steps as Qt: parse with ``seqalign.aln_magic_read``; a FASTA
        with fewer than two records (or ragged lengths, which makes the reader
        raise ``ValueError``) is not an alignment and the dialog is skipped in
        favour of a plain ``cmd.load`` — that is what ``fallback`` means here.
        Otherwise build the id→object similarity matrix with
        ``difflib.SequenceMatcher`` and greedily assign the argmax, exactly as
        ``:236-247`` does, so the combo boxes come pre-filled.
        """
        info: Dict[str, Any] = {
            "ids": [],
            "models": list(self.cmd.get_object_list() or []),
            "mapping": {},
            "fallback": False,
            "error": None,
        }
        try:
            import difflib

            import numpy
            import pymol.seqalign as seqalign

            alignment = seqalign.aln_magic_read(self.expand(filename))
            if fmt == "fasta" and len(alignment) < 2:
                raise ValueError("a single sequence is not an alignment")
        except ValueError as exc:
            info["fallback"] = True
            info["error"] = str(exc)
            return info
        except Exception as exc:  # noqa: BLE001
            info["fallback"] = True
            info["error"] = str(exc)
            return info

        ids = [rec.id for rec in alignment]
        info["ids"] = list(ids)
        models = info["models"]
        ids_remain = list(ids)
        models_remain = list(models)
        mapping: Dict[str, str] = {}
        n, m = len(ids), len(models)
        if n and m:
            similarity = numpy.zeros((n, m))
            for i in range(n):
                for j in range(m):
                    similarity[i, j] = difflib.SequenceMatcher(
                        None, ids[i], models[j], False
                    ).ratio()
            for _ in range(min(n, m)):
                i, j = numpy.unravel_index(similarity.argmax(), similarity.shape)
                mapping[ids_remain.pop(i)] = models_remain.pop(j)
                similarity = numpy.delete(similarity, i, axis=0)
                similarity = numpy.delete(similarity, j, axis=1)
        info["mapping"] = mapping
        return info

    def load_aln(self, filename: str, mapping: Optional[Dict[str, str]] = None) -> Dict[str, Any]:
        """``seqalign.load_aln_multi`` — the alignment dialog's OK button.

        ``pymol.seqalign`` is not one of the policy's addressable roots, so the
        call is made here rather than by the client.
        """
        import pymol.seqalign as seqalign

        seqalign.load_aln_multi(
            self.expand(filename), mapping=dict(mapping or {}), _self=self.cmd
        )
        return {"loaded": True, "names": list(self.cmd.get_names())}

    def mae_dialog_info(self, filename: str) -> Dict[str, Any]:
        """``load_mae_dialog`` (``file_dialogs.py:285-333``)."""
        from pymol import importing

        from ..incentive_only import UNAVAILABLE_FORMATS

        return {
            "objectName": importing.filename_to_objectname(filename),
            "objectProps": self.cmd.get("load_object_props_default") or "*",
            "atomProps": self.cmd.get("load_atom_props_default") or "*",
            "choices": [dict(item) for item in MAE_MULTIPLEX_CHOICES],
            "unavailable": UNAVAILABLE_FORMATS.get(".mae"),
        }

    def mtz_dialog_info(self, filename: str) -> Dict[str, Any]:
        """``load_mtz_dialog`` (``file_dialogs.py:152-201``).

        The header parse is real (``pymol.headering.MTZHeader``); the load
        itself is Incentive-only in this build (``importing.py:1481-1511``),
        so ``unavailable`` is always populated and the UI must say so.
        """
        from ..incentive_only import UNAVAILABLE_FORMATS

        info: Dict[str, Any] = {
            "unavailable": UNAVAILABLE_FORMATS.get(".mtz"),
            "amplitudes": [],
            "phases": [],
            "weights": [],
            "resoMin": 0.0,
            "resoMax": 0.0,
            "guessAmplitudes": None,
            "guessPhases": None,
            "error": None,
            "prefix": "",
        }
        if not os.path.isfile(self.expand(filename)):
            info["error"] = "no such file: %s" % filename
            return info
        try:
            from pymol import headering, importing

            header = headering.MTZHeader(self.expand(filename))
            # The four calls, in the Qt dialog's order (file_dialogs.py:157-162).
            info["amplitudes"] = list(header.getColumnsOfType("F")) + list(
                header.getColumnsOfType("G")
            )
            info["phases"] = list(header.getColumnsOfType("P"))
            info["weights"] = list(header.getColumnsOfType("W")) + list(
                header.getColumnsOfType("Q")
            )
            f2, p2, _ = header.guessCols("2FoFc")
            f1, p1, _ = header.guessCols("FoFc")
            for col in (f2, f1):
                if col in info["amplitudes"]:
                    info["guessAmplitudes"] = col
                    break
            for col in (p2, p1):
                if col in info["phases"]:
                    info["guessPhases"] = col
                    break
            info["resoMin"] = float(getattr(header, "reso_min", None) or 0.0)
            info["resoMax"] = float(getattr(header, "reso_max", None) or 0.0)
            info["prefix"] = importing.filename_to_objectname(filename)
        except Exception as exc:  # noqa: BLE001
            info["error"] = str(exc)
        return info

    # -------------------------------------------------- map generation (259)

    def map_generate_info(self, filename: str) -> Dict[str, Any]:
        """Everything ``PyMOLMapLoad`` reads when it opens (``PyMOLMapLoad.py:10-175``).

        Deliberately a superset of :meth:`mtz_dialog_info`, which serves the
        *other* MTZ dialog (``load_mtz``, Incentive-only): this one adds the Pmw
        dialog's ``"None"`` weights entry, its ``%3.5f`` resolution defaults,
        the two ``default_*_map_rep`` settings that decide what gets built after
        the map appears, and ``autoclose_dialogs``.

        ``supported`` is deliberately ``None`` until something has actually
        tried: nothing static distinguishes an ``NO_MMLIBS`` build from a full
        one (``packages/engine/layer3/Executive.cpp:6929``), and :meth:`map_generate_run`
        answers it from ``cmd.get_names()``.  ``buildNote`` states what was
        measured on this tree.
        """
        info: Dict[str, Any] = {
            "filename": filename,
            "headerClass": None,
            "amplitudes": [],
            "phases": [],
            # `WCols = ["None"]` FIRST, then W then Q columns (`:104-107`), and
            # "None" is the selected item (`:115`).
            "weights": ["None"],
            "guessAmplitudes": None,
            "guessPhases": None,
            "minRes": "",
            "maxRes": "",
            "prefix": "",
            "fofc": False,
            "fofcRep": self.cmd.get_setting_text("default_fofc_map_rep"),
            "twoFofcRep": self.cmd.get_setting_text("default_2fofc_map_rep"),
            "autocloseDialogs": bool(
                self.cmd.get_setting_boolean("autoclose_dialogs")
            ),
            "supported": _MAP_GENERATE_STATUS["works"],
            "buildNote": MAP_GENERATE_BUILD_NOTE,
            "missingAmplitudesHelp": MISSING_AMPLITUDES_HELP,
            "missingPhasesHelp": MISSING_PHASES_HELP,
            "error": None,
        }
        full = self.expand(filename)
        info["headerClass"] = MAP_HEADER_CLASSES.get(full[-3:].lower())
        if not os.path.isfile(full):
            info["error"] = "no such file: %s" % filename
            return info
        if info["headerClass"] != "MTZHeader":
            # `PyMOLMapLoad` builds a CIFHeader/CNSHeader here, but
            # `cmd.map_generate` hard-codes `headering.MTZHeader`
            # (`creating.py:236`) with a "TODO: work for CIF, MTZ, and CNS" —
            # so anything but .mtz cannot reach the generator at all.
            info["error"] = non_mtz_refusal(filename)
            return info
        try:
            from pymol import headering

            header = headering.MTZHeader(full)
            amps = list(header.getColumnsOfType("F")) + list(
                header.getColumnsOfType("G")
            )
            phases = list(header.getColumnsOfType("P"))
            weights = list(header.getColumnsOfType("W")) + list(
                header.getColumnsOfType("Q")
            )
            info["amplitudes"] = amps or [""]
            info["phases"] = phases or [""]
            info["weights"] = ["None"] + weights

            # `:71-80` / `:92-100`: 2FoFc's guess wins, FoFc is the fallback, and
            # each is used ONLY if it is actually in the list.
            f2, p2, _ = header.guessCols("2FoFc")
            f1, p1, _ = header.guessCols("FoFc")
            info["guessAmplitudes"] = _first_in(info["amplitudes"], f2, f1)
            info["guessPhases"] = _first_in(info["phases"], p2, p1)
            # `:124-131`: "%3.5f" of the header value, or "" when it is None.
            info["minRes"] = _reso_default(getattr(header, "reso_min", None))
            info["maxRes"] = _reso_default(getattr(header, "reso_max", None))
        except Exception as exc:  # noqa: BLE001
            info["error"] = str(exc)
        return info

    def map_generate_run(
        self,
        filename: str,
        amplitudes: str,
        phases: str,
        weights: str = "None",
        min_res: Any = "",
        max_res: Any = "",
        name_prefix: str = "",
        fofc: bool = False,
    ) -> Dict[str, Any]:
        """``PyMOLMapLoad.run("OK")`` (``PyMOLMapLoad.py:240-341``).

        Order preserved exactly: derive the prefix, ``get_unused_name`` it,
        validate the two required columns (returning the dialog's own help text,
        which is what Pmw would have popped in a ``TextDialog``), call
        ``cmd.map_generate``, then build the representation inside
        ``suspend_updates``.

        ONE DELIBERATE DIVERGENCE, and it is the point of the port: the Tk code
        tests ``cmd.map_generate``'s **return value** for success
        (``:288``), and that value is the map name on failure as well
        (``creating.py:289``) — so upstream goes on to isomesh a map object that
        does not exist.  Here success is ``prefix in cmd.get_names()``.
        """
        report: Dict[str, Any] = {
            "ok": False,
            "prefix": "",
            "returned": None,
            "created": False,
            "reps": [],
            "rep": "",
            "error": None,
            "help": None,
            "autoclose": bool(self.cmd.get_setting_boolean("autoclose_dialogs")),
            "buildNote": MAP_GENERATE_BUILD_NOTE,
        }
        amplitudes = amplitudes or ""
        phases = phases or ""
        if not len(amplitudes):
            report["error"] = "Missing Amplitudes Column Name"
            report["help"] = MISSING_AMPLITUDES_HELP
            return report
        if not len(phases):
            report["error"] = "Missing Phases Column Name"
            report["help"] = MISSING_PHASES_HELP
            return report

        # AFTER the two column checks, because that is the Pmw dialog's order
        # (`:259-278` pops the help text first), and before the call, because
        # `cmd.map_generate` reports a missing file to the CONSOLE and raises a
        # bare `CmdException` — MEASURED over the socket, `str(exc)` is
        # ``' Error: '`` and nothing else, so a client that shows the error has
        # nothing to show (`creating.py:230-232`).
        if not os.path.isfile(self.expand(filename)):
            report["error"] = "no such file: %s" % filename
            return report

        # …and the format check the info call already makes, repeated here
        # because `run` is reachable without it (a typed path, a client that
        # skipped the probe). Without it a `.cif` walked into MTZHeader's
        # binary parser: MEASURED, `map_generate_run(1bna.cif, FWT, PHWT)`
        # answered `error="'<' not supported between instances of 'int' and
        # 'NoneType'"`, having already burned a `get_unused_name`.
        if MAP_HEADER_CLASSES.get(self.expand(filename)[-3:].lower()) != "MTZHeader":
            report["error"] = non_mtz_refusal(filename)
            return report

        prefix = self.cmd.get_unused_name(map_generate_prefix(amplitudes, name_prefix))
        report["prefix"] = prefix

        # `:281-283`: min/max come straight out of the (string) entry fields.
        low, high = _reso_float(min_res), _reso_float(max_res)
        try:
            report["returned"] = self.cmd.map_generate(
                prefix, self.expand(filename), amplitudes, phases,
                weights or "None", low, high, 1, 1,
            )
        except Exception as exc:  # noqa: BLE001 - Pmw prints and returns None
            report["error"] = str(exc)
            _MAP_GENERATE_STATUS.update({"tried": True, "works": False})
            return report

        created = prefix in (self.cmd.get_names() or [])
        report["created"] = created
        _MAP_GENERATE_STATUS.update({"tried": True, "works": created})
        if not created:
            report["error"] = (
                "map_generate returned %r but created no object: %s"
                % (report["returned"], MAP_GENERATE_BUILD_NOTE)
            )
            return report

        rep = self.cmd.get_setting_text(
            "default_fofc_map_rep" if fofc else "default_2fofc_map_rep"
        )
        report["rep"] = rep
        self.cmd.set("suspend_updates", 1)
        try:
            for step in map_rep_plan(rep, prefix, bool(fofc)):
                name = self.cmd.get_unused_name(step["stem"])
                if step["op"] == "isosurface":
                    self.cmd.isosurface(name, prefix, level=step["level"])
                elif step["op"] == "isomesh":
                    self.cmd.isomesh(name, prefix, level=step["level"])
                else:
                    self.cmd.volume(name, prefix, step["ramp"])
                if step["color"]:
                    self.cmd.color(step["color"], name)
                report["reps"].append({"name": name, "op": step["op"]})
        except Exception as exc:  # noqa: BLE001 - `:332-333` is a bare except
            report["error"] = str(exc)
        finally:
            self.cmd.set("suspend_updates", 0)
        report["ok"] = True
        return report

    # ------------------------------------------- Finder "Open With" (293)

    def open_with_plan(self, filename: str) -> Dict[str, Any]:
        """``PyMOLApplication.handle_file_open_active`` (``pymol_qt_gui.py:1140-1160``).

        Returned as DATA rather than performed, because the first branch —
        "open it in a new PyMOL instance" — is a second OS process, and in a web
        client that decision belongs to whoever owns the process model, not to a
        file panel.

        Measured defaults in this bridge: ``reuse_helper`` 0 and
        ``auto_reinitialize`` 0, so a Finder open with any object loaded would
        take the ``new_window`` branch upstream.

        ONE DELIBERATE DIVERGENCE, measured: upstream asks
        ``ev.file().endswith('.psw')`` (``:1154``), which is narrower than every
        other definition of a PyMOL Show file in the same program.  Qt's own
        open filter is ``PyMOL Show File (*.psw *.pzw *.psw.gz)``
        (``pymol_qt_gui.py:660``) and ``filename_to_format`` maps BOTH ``.pzw``
        and ``.psw.gz`` to format ``psw`` (``importing.py:63-65,43-47``) — so
        the engine starts the presentation for those two (``load_pse`` runs
        ``rewind`` + ``scene auto start`` under ``presentation_auto_start``,
        ``importing.py:843-852``, observed) while the Finder handler leaves the
        window in normal mode.  This asks the parsed format instead, so all
        three PyMOL Show extensions get the same preset.
        """
        from pymol import invocation

        options = getattr(invocation, "options", None)
        reuse_helper = bool(getattr(options, "reuse_helper", 0))
        auto_reinitialize = bool(getattr(options, "auto_reinitialize", 0))
        names = list(self.cmd.get_names() or [])
        new_window = (not reuse_helper) and bool(names)
        classification = classify_filename(filename)
        is_show_file = classification["format"] == "psw"
        return {
            "filename": filename,
            "reuseHelper": reuse_helper,
            "autoReinitialize": auto_reinitialize,
            "names": names,
            # `:1145-1147` — the ONLY case that spawns another process.
            "action": "new-window" if new_window else "load-here",
            "reinitialize": (not new_window) and auto_reinitialize,
            "presentation": (not new_window) and is_show_file,
            "presetSteps": [dict(step) for step in PSW_PRESET_STEPS],
            "classification": classification,
        }

    def presentation_preset(self, full_screen: bool = True) -> Dict[str, Any]:
        """The four ``.psw`` statements (``pymol_qt_gui.py:1152-1156``).

        Returns the PREVIOUS values, which upstream throws away — a browser tab
        that switched itself to presentation mode has to be able to switch back,
        and there is no window manager here to do it for the user.

        ``full_screen`` is reported, never assumed: ``CmdFullScreen``
        (``packages/engine/layer4/Cmd.cpp:5352-5362``) never assigns its ``ok`` flag, so
        ``cmd.full_screen`` raises ``CmdException`` on every platform and every
        build *after* the C++ side has already run.  Measured over the socket:
        ``pymol.CmdException: ' Error: '`` from ``viewing.py:1356``.
        """
        previous = {
            "presentation": self.cmd.get("presentation"),
            "internal_gui": self.cmd.get("internal_gui"),
            "internal_feedback": self.cmd.get("internal_feedback"),
        }
        self.cmd.set("presentation")  # `cmd.set(name)` defaults value to 1
        self.cmd.set("internal_gui", 0)
        self.cmd.set("internal_feedback", 0)
        result: Dict[str, Any] = {
            "previous": previous,
            "current": {
                "presentation": self.cmd.get("presentation"),
                "internal_gui": self.cmd.get("internal_gui"),
                "internal_feedback": self.cmd.get("internal_feedback"),
            },
            "fullScreen": {"attempted": bool(full_screen), "ok": False,
                           "error": None},
        }
        if full_screen:
            try:
                self.cmd.full_screen("on")
                result["fullScreen"]["ok"] = True
            except Exception as exc:  # noqa: BLE001
                result["fullScreen"]["error"] = (
                    "%s -- cmd.full_screen always raises: CmdFullScreen "
                    "(packages/engine/layer4/Cmd.cpp:5352-5362) returns APIResultOk(G, ok) with "
                    "ok never assigned" % (str(exc).strip() or "CmdException")
                )
        return result

    def presentation_restore(self, previous: Dict[str, Any]) -> Dict[str, Any]:
        """Undo :meth:`presentation_preset`.  Upstream has no such thing."""
        for name in ("presentation", "internal_gui", "internal_feedback"):
            if name in (previous or {}):
                self.cmd.set(name, previous[name])
        return {
            "presentation": self.cmd.get("presentation"),
            "internal_gui": self.cmd.get("internal_gui"),
            "internal_feedback": self.cmd.get("internal_feedback"),
        }

    # ------------------------------------ blocking plugin dialogs (295)

    def install_tk_dialogs(self) -> Dict[str, Any]:
        """Install the ``tkFileDialog`` / ``tkinter.filedialog`` shim."""
        state = install_tk_filedialog(self.broker)
        state["engineThread"] = engine_thread()
        state["timeout"] = DialogBroker.DEFAULT_TIMEOUT
        return state

    def uninstall_tk_dialogs(self) -> Dict[str, Any]:
        return {"removed": uninstall_tk_filedialog()}

    def tk_dialogs_status(self) -> Dict[str, Any]:
        return {
            "installed": tk_filedialog_installed(),
            "engineThread": engine_thread(),
            "timeout": DialogBroker.DEFAULT_TIMEOUT,
            "pending": self.broker.pending(),
        }

    def dialog_pending(self) -> List[Dict[str, Any]]:
        """Blocking dialogs waiting for the browser, oldest first."""
        return self.broker.pending()

    def dialog_answer(self, dialog_id: int, value: Any) -> Dict[str, Any]:
        """Unblock one dialog.  ``value`` is a path, a list of paths, or null."""
        return self.broker.answer(dialog_id, value)

    def dialog_cancel(self, dialog_id: int) -> Dict[str, Any]:
        return self.broker.cancel(dialog_id)

    def dialog_history(self) -> List[Dict[str, Any]]:
        return self.broker.history()

    # ------------------------------------------------------------ saving

    def with_ext(self, fname: str, filter_text: str) -> str:
        return with_extension(fname, filter_text)

    def save_check(self, fname: str, filter_text: str = "") -> Dict[str, Any]:
        """Validate a save target before ``cmd.save`` throws.

        ``cmd.save`` raises "Unrecognized file format" on an unknown extension
        (``exporting.py:836-843``) despite what its docstring claims, so the
        picker checks first.

        ``unavailable`` answers from :data:`SAVE_UNAVAILABLE_FORMATS`, the
        EXPORT-side manifest.  It used to answer from the import-side one,
        which got ``.mae`` wrong in both directions: saving a ``.mae`` works
        (measured) and was annotated as impossible, while ``.mtl`` and ``.obj``
        -- which really do raise / write nothing -- were not annotated at all.
        """
        from pymol import exporting, importing

        final = with_extension(fname, filter_text)
        _prefix, ext, fmt, zipped = importing.filename_to_format(final)
        recognised = bool(fmt) and (
            fmt in exporting.savefunctions
            or fmt in ("mmod", "pkl", "pkla", "pse", "psw")
        )
        exists = os.path.exists(self.expand(final)) if final else False
        parent = os.path.dirname(self.expand(final)) or "."
        return {
            "filename": final,
            "ext": ext,
            "format": fmt,
            "zipped": zipped,
            "recognised": recognised,
            "exists": exists,
            "parentWritable": os.access(parent, os.W_OK),
            "unavailable": SAVE_UNAVAILABLE_FORMATS.get("." + (fmt or ext or "")),
            "error": (
                None
                if recognised
                else "Unrecognized file format '%s' (cmd.save would raise, "
                "exporting.py:841-843)" % (ext or "")
            ),
        }

    def save_molecule_info(self) -> Dict[str, Any]:
        """``file_save`` (``file_dialogs.py:519-562``) — everything it reads."""
        get_int = self.cmd.get_setting_int
        models = list(self.cmd.get_object_list() or [])
        selections = list(self.cmd.get_names("public_selections") or [])
        return {
            "objects": models,
            "selections": selections,
            "states": int(self.cmd.count_states()),
            "filters": list(SAVE_MOLECULE_FILTERS),
            "settings": {
                # The three inverted checkboxes are inverted here too, exactly
                # as `file_dialogs.py:523-528` does it.
                "no_pdb_conect_nodup": not get_int("pdb_conect_nodup"),
                "pdb_conect_all": bool(get_int("pdb_conect_all")),
                "no_ignore_pdb_segi": not get_int("ignore_pdb_segi"),
                "pdb_retain_ids": bool(get_int("pdb_retain_ids")),
                "retain_order": bool(get_int("retain_order")),
            },
        }

    def multifilenamegen(
        self, pattern: str, selection: str = "(all)", state: int = -1
    ) -> Dict[str, Any]:
        """``cmd.multifilenamegen`` materialised into JSON.

        MEASURED, do not "simplify" back to a direct client call:
        ``multifilenamegen`` is a **generator function**
        (``exporting.py:735-781`` — its body ends in ``yield fname, osele,
        ostate``), so ``{t:'call', fn:'cmd.multifilenamegen'}`` returns a
        ``builtins.generator`` and the bridge codec refuses it outright
        ("no codec entry for builtins.generator", ``tenmol_bridge/codec.py``).
        The Export Molecule dialog's "prompt for every file" mode therefore has
        to consume it here, on the engine side.

        ``ValueError('need one or more of {name}, {num}, {state}, {title}')``
        (``:752``) is returned as ``error`` rather than raised, because it is a
        user-input mistake the dialog must show, not a transport failure.
        """
        try:
            items = [
                {"filename": fname, "selection": osele, "state": int(ostate)}
                for fname, osele, ostate in self.cmd.multifilenamegen(
                    pattern, selection, int(state)
                )
            ]
        except Exception as exc:  # noqa: BLE001
            return {"ok": False, "error": str(exc), "items": []}
        return {"ok": True, "error": None, "items": items}

    def names_of_type(self, otype: str) -> List[str]:
        """``cmd.get_names_of_type`` — Export Map / Export Alignment."""
        return list(self.cmd.get_names_of_type(otype) or [])

    def session_file(self) -> Dict[str, Any]:
        """``session_save`` (``pymol_qt_gui.py:651-655``).

        ``cmd.get('session_file')`` through ``cmd.as_pathstr``; empty means
        Save Session must fall back to Save-As.
        """
        raw = self.cmd.get("session_file")
        try:
            path = self.cmd.as_pathstr(raw)
        except Exception:  # noqa: BLE001
            path = raw
        return {"path": path or "", "hasPath": bool(path), "filters": list(SESSION_FILTERS)}

    # ------------------------------------------------------------ images/movies

    def encoders(self) -> Dict[str, Any]:
        """``pymol.movie.find_exe`` per encoder (``movie.py:824-844``).

        The Qt dialog pops "Encoder 'x' is not installed." when the binary is
        missing; the web dialog has to ask the server instead of guessing.
        """
        from pymol import movie

        found = {}
        for name in ("ffmpeg", "mpeg_encode", "convert"):
            try:
                found[name] = movie.find_exe(name) or None
            except Exception:  # noqa: BLE001
                found[name] = None
        return found

    def movie_dialog_info(self) -> Dict[str, Any]:
        """``file_save_mpeg`` initial values (``file_dialogs.py:794-800``)."""
        viewport = self.cmd.get_viewport()
        encoders = self.encoders()
        default = ""
        for name in ("ffmpeg", "mpeg_encode", "convert"):
            if encoders.get(name):
                default = name
                break
        return {
            "width": int(viewport[0]),
            "height": int(viewport[1]),
            "quality": int(self.cmd.get_setting_int("movie_quality")),
            "ray": bool(self.cmd.get_setting_int("ray_trace_frames")),
            "encoders": encoders,
            "defaultEncoder": default,
            "support": {k: dict(v) for k, v in MOVIE_ENCODER_SUPPORT.items()},
            "filters": dict(MOVIE_FILTERS),
            "frames": int(self.cmd.count_frames()),
        }

    def produce(self, filename: str, **kwargs: Any) -> Dict[str, Any]:
        """``pymol.movie.produce`` with the bridge's stdin taken away from it.

        MEASURED BUG, and the reason this wrapper exists at all: calling
        ``movie.produce`` directly **kills the bridge process**.
        ``movie._encode`` shells out with ``subprocess.call([...])``
        (``packages/engine/modules/pymol/movie.py:770-800``) and passes no ``stdin``, so
        ``ffmpeg`` inherits the server's descriptor 0 and consumes it — the
        server then sees its own stdin closed and shuts down.  Observed twice
        end to end: uvicorn logged ``Shutting down`` on the line after
        ``produce: finished.``, the browser dropped to the reconnect overlay,
        and the same command with ``< /dev/null`` survived.

        Redirecting fd 0 (not ``sys.stdin``) is what it takes, because the
        child inherits the *descriptor*, not the Python object.  PyMOL's own
        source is off limits to this work package, so the guard lives here.

        AND THE GUARD ONLY COVERS THE ENCODER IF THE ENCODER IS SYNCHRONOUS,
        which upstream's is not.  ``produce`` hard-codes ``mpng(..., modal=-1)``
        (``movie.py:973``); ``MoviePNG`` reads any non-zero ``modal`` as
        "install ``MovieModalDraw``" unless the mode is ray
        (``packages/engine/layer1/Movie.cpp:836-865``), so ``get_modal_draw()`` is true when
        ``produce`` reaches ``:982-987`` and ``_encode`` — the ffmpeg spawn —
        goes to a **daemon thread**.  The ``finally`` below then restored fd 0
        before ffmpeg was ever started, and `` produce: finished.`` was printed
        by that detached thread: exactly the ordering the wave-4 note recorded
        the shutdown after.  MEASURED over the socket on the unpatched build::

            cmd.tenmol_files.produce(f, mode='draw')
                -> {'ok': False, 'size': 0, 'error': 'no output file was written'}
            cmd.mset  ->  pymol.CmdException: ' Error: APIEnterNotModal(G)'
            (the .mp4 appeared ~1.5 s later, written by the detached thread)

        i.e. the browser was told the export had failed while it was still
        running, and the next call into the engine raised.  Handing ``produce``
        the same ``_ModalOverride`` proxy the movie panel uses pins ``modal=0``,
        so ``MoviePNG`` completes inside this one pump task, ``produce`` takes
        the *inline* ``_encode`` branch, and ffmpeg is spawned while fd 0 is
        still ``/dev/null``.  The cost, stated: the pump is busy for the whole
        export instead of for none of it (``panels/movie.py::_ModalOverride``).
        """
        from pymol import movie

        from .movie import _ModalOverride

        devnull = os.open(os.devnull, os.O_RDONLY)
        saved = os.dup(0)
        try:
            os.dup2(devnull, 0)
            movie.produce(
                self.expand(filename), _self=_ModalOverride(self.cmd, 0), **kwargs
            )
        except Exception as exc:  # noqa: BLE001
            return {"ok": False, "error": str(exc), "path": self.expand(filename)}
        finally:
            # ``_encode:811`` is the only ``unset('keep_alive')`` upstream has
            # and it is not reached when ``mpng`` raises, which would pin the
            # engine awake for the rest of the session.  Safe to force here
            # only because the encode is now synchronous.
            try:
                self.cmd.unset("keep_alive")
            except Exception:  # noqa: BLE001
                pass
            os.dup2(saved, 0)
            os.close(saved)
            os.close(devnull)
        target = self.expand(filename)
        return {
            "ok": os.path.exists(target),
            "error": None if os.path.exists(target) else "no output file was written",
            "path": target,
            "size": os.path.getsize(target) if os.path.exists(target) else 0,
        }

    def render_info(self) -> Dict[str, Any]:
        """Draw/Ray panel seeds (``pymol_qt_gui.py:673-790``)."""
        viewport = self.cmd.get_viewport()
        return {
            "width": int(viewport[0]),
            "height": int(viewport[1]),
            "dpi": int(self.cmd.get_setting_int("image_dots_per_inch")),
            "dpiChoices": [300, 150, 90],
            "units": ["cm", "inch"],
            "opaqueBackground": bool(self.cmd.get_setting_int("opaque_background")),
        }

    # ------------------------------------------------------------ log/scripts

    def log_status(self) -> Dict[str, Any]:
        """Is a log file open, and which (``commanding.py:107-227``)?

        ``logging`` is 0 (off), 1 (pml) or 2 (python); the handle lives on the
        ``pymol`` module for the whole session.
        """
        import pymol

        handle = getattr(pymol, "_log_file", None)
        path = ""
        if handle is not None:
            path = getattr(handle, "filename", "") or getattr(handle, "name", "") or ""
        return {
            "logging": int(self.cmd.get_setting_int("logging")),
            "path": path if isinstance(path, str) else "",
            "open": handle is not None,
            "filters": list(LOG_FILTERS),
        }

    def run_plan(self, paths: Sequence[str], python_filter: bool = False) -> Dict[str, Any]:
        """``file_run`` (``pymol_qt_gui.py:847-868``) as data.

        Per file: ``initialdir`` moves, ``cmd.cd(initialdir, quiet=0)`` runs
        FIRST, then ``.py/.pym/.pyc/.pyo/.py.txt`` (or an explicitly selected
        "Python …" filter) goes to ``cmd.run`` and everything else to
        ``cmd.do("@" + fname)``.
        """
        steps = []
        for name in paths or ():
            directory = os.path.dirname(name)
            is_py = bool(python_filter) or bool(
                re.search(r"\.py(|m|c|o|\.txt)$", name, re.I)
            )
            steps.append(
                {
                    "filename": name,
                    "cd": directory,
                    "how": "run" if is_py else "at",
                    "command": ("run " + name) if is_py else ("@" + name),
                }
            )
        return {"steps": steps, "filters": list(RUN_FILTERS)}

    def pymolrc(self) -> Dict[str, Any]:
        """The pymolrc candidates (File ▸ Edit pymolrc)."""
        from pymol import invocation

        try:
            paths = list(invocation.get_user_config())
        except Exception:  # noqa: BLE001
            paths = []
        return {
            "paths": [p for p in paths if isinstance(p, str)],
            "home": os.path.expanduser("~"),
        }

    # ------------------------------------------------------------ fetch

    def fetch_info(self) -> Dict[str, Any]:
        """Everything the Get-PDB dialog needs from settings.

        ``fetch_path`` defaults to ``'.'`` and is special-cased in
        ``packages/engine/layer1/Setting.cpp:644``; ``fetch_host`` (default ``"pdb"``) and
        ``fetch_type_default`` (default ``"cif"``) drive ``_fetch``
        (``importing.py:1155-1272``).
        """
        try:
            raw_path = self.cmd.get("fetch_path")
        except Exception:  # noqa: BLE001
            raw_path = "."
        expanded = self.expand(raw_path or ".")
        return {
            "fetchPath": expanded,
            "fetchPathRaw": raw_path,
            "fetchPathWritable": os.access(expanded or ".", os.W_OK),
            "fetchHost": self.cmd.get("fetch_host"),
            "fetchTypeDefault": self.cmd.get("fetch_type_default"),
            "assembly": self.cmd.get("assembly"),
        }

    def set_fetch_path(self, path: str) -> Dict[str, Any]:
        self.cmd.set("fetch_path", self.expand(path), quiet=0)
        return self.fetch_info()

    def pdbe_start(self, code: str) -> Dict[str, Any]:
        """Kick off the two PDBe lookups on a WORKER thread.

        Qt does this with ``AsyncFunc`` (``pymol/Qt/utils.py:100-125``) for the
        same reason: ``urlopen`` against ebi.ac.uk takes hundreds of
        milliseconds and this method is called on the engine thread, which also
        runs the 60 Hz draw pump.
        """
        code = (code or "").strip().lower()
        if len(code) != 4:
            return {"code": code, "pending": False, "error": "Need 4 letter PDB code"}
        with self._pdbe_lock:
            state = self._pdbe.get(code)
            if state is not None and (state["pending"] or state["done"] > time.time() - 300):
                return {"code": code, "pending": state["pending"], "cached": True}
            self._pdbe[code] = {
                "pending": True,
                "assemblies": [],
                "chains": [],
                "error": None,
                "done": 0.0,
            }
        thread = threading.Thread(
            target=self._pdbe_worker, args=(code,), name="tenmol-pdbe", daemon=True
        )
        thread.start()
        return {"code": code, "pending": True, "cached": False}

    def pdbe_result(self, code: str) -> Dict[str, Any]:
        code = (code or "").strip().lower()
        with self._pdbe_lock:
            state = self._pdbe.get(code)
            if state is None:
                return {"code": code, "pending": False, "started": False,
                        "assemblies": [], "chains": [], "error": None}
            return {
                "code": code,
                "started": True,
                "pending": state["pending"],
                "assemblies": list(state["assemblies"]),
                "chains": list(state["chains"]),
                "error": state["error"],
            }

    def _pdbe_worker(self, code: str) -> None:
        assemblies: List[str] = []
        chains: List[str] = []
        error: Optional[str] = None
        try:
            assemblies = _get_assemblies(code)
            chains = _get_chains(code)
        except Exception as exc:  # noqa: BLE001
            error = str(exc)
        with self._pdbe_lock:
            self._pdbe[code] = {
                "pending": False,
                "assemblies": assemblies,
                "chains": chains,
                "error": error,
                "done": time.time(),
            }

    # ------------------------------------------------------------ transfer

    #: A script or an rc file is text a person typed. 8 MB is far past any of
    #: those and far short of the download cap, which exists for `.pse` blobs.
    MAX_TEXT_BYTES = 8 * 1024 * 1024

    def read_text(self, path: str) -> Dict[str, Any]:
        """Read a server file as text, for the script / pymolrc editor.

        The editor used to call `_bridge.read_text_file`, which DOES NOT EXIST
        (measured: `no render route for '_bridge.read_text_file'`), so opening
        a file on the PyMOL host failed and the panel fell back to the browser
        file picker — which cannot edit a pymolrc in place, the one thing that
        row of the inventory is about.

        Errors are RETURNED, not raised: the editor shows them in its own
        status line next to the filename, and an exception would lose which
        path failed by the time it reached the UI.
        """
        full = self.expand(path)
        try:
            size = os.path.getsize(full)
        except OSError as exc:
            return {"path": full, "ok": False, "text": "", "error": str(exc)}
        if size > self.MAX_TEXT_BYTES:
            return {
                "path": full,
                "ok": False,
                "text": "",
                "size": size,
                "error": "%d bytes exceeds the %d byte text cap"
                % (size, self.MAX_TEXT_BYTES),
            }
        try:
            with open(full, "r", encoding="utf-8", errors="replace") as handle:
                text = handle.read()
        except OSError as exc:
            return {"path": full, "ok": False, "text": "", "error": str(exc)}
        return {
            "path": full,
            "ok": True,
            "text": text,
            "size": size,
            "name": os.path.basename(full),
            "error": None,
        }

    def write_text(self, path: str, text: str) -> Dict[str, Any]:
        """Write a server file as text.

        `errors="replace"` on the READ side means a binary file opened by
        mistake comes back with U+FFFD in it; writing that back would corrupt
        the file silently. So a write refuses if the target exists and is not
        decodable as UTF-8 — the editor cannot have produced a faithful copy
        of something it could not read.
        """
        full = self.expand(path)
        if not full or os.path.isdir(full):
            return {"path": full, "ok": False, "error": "not a writable path"}
        if os.path.exists(full) and not self._is_utf8(full):
            return {
                "path": full,
                "ok": False,
                "error": (
                    "refusing to overwrite %s: it is not UTF-8 text, so what "
                    "the editor loaded is not a faithful copy of it"
                    % os.path.basename(full)
                ),
            }
        try:
            with open(full, "w", encoding="utf-8") as handle:
                handle.write(text)
        except OSError as exc:
            return {"path": full, "ok": False, "error": str(exc)}
        return {
            "path": full,
            "ok": True,
            "size": len(text.encode("utf-8")),
            "name": os.path.basename(full),
            "error": None,
        }

    @staticmethod
    def _is_utf8(full: str) -> bool:
        try:
            with open(full, "rb") as handle:
                handle.read(1024 * 1024).decode("utf-8")
        except (OSError, UnicodeDecodeError):
            return False
        return True

    def copy_image_png(self, dpi: int = -1) -> Dict[str, Any]:
        """The last rendered image as base64 PNG, for the clipboard.

        Qt does this by writing `cmd.png(tempfile, prior=1, dpi=...)` and
        pushing the resulting QImage onto the Qt clipboard
        (`pymol_qt_gui.py:1170-1186`). A browser cannot be handed a QImage, and
        `cmd._copy_image` is a stub that raises headlessly, so the bytes come
        back over the wire instead and the client writes them with
        `navigator.clipboard.write(new ClipboardItem({'image/png': blob}))`.

        `prior=1` is the whole point: it saves the image ALREADY rendered
        rather than rendering a new one, so "copy" copies what is on screen —
        including a ray trace, which re-rendering would be minutes of work to
        reproduce.

        Measured: with nothing rendered yet, `cmd.png(prior=1)` raises and
        writes no file. That is Qt's "no prior image" case, and it is returned
        as `ok: False` with that message rather than raised, so the button can
        say it in place instead of throwing.
        """
        import tempfile

        handle, temp = tempfile.mkstemp(suffix=".png", prefix="tenmol-copy-")
        os.close(handle)
        try:
            try:
                kwargs = {"prior": 1}
                if int(dpi) > 0:
                    kwargs["dpi"] = int(dpi)
                self.cmd.png(temp, **kwargs)
            except Exception as exc:  # noqa: BLE001 - reported, not raised
                return {"ok": False, "base64": "", "error": str(exc) or "no prior image"}

            if not os.path.exists(temp) or os.path.getsize(temp) == 0:
                return {"ok": False, "base64": "", "error": "no prior image"}
            with open(temp, "rb") as png:
                blob = png.read()
            return {
                "ok": True,
                "base64": base64.b64encode(blob).decode("ascii"),
                "bytes": len(blob),
                "error": None,
            }
        finally:
            try:
                os.unlink(temp)
            except OSError:
                pass

    def download(self, path: str, max_bytes: int = 0) -> Dict[str, Any]:
        """Base64 a server file so the browser can save a copy.

        The primary flow is still "write to a server path" — this is the
        "I want it on my laptop" escape hatch of ``file-io.md`` §0, and it is
        capped, because a big ``.pse`` does not belong on the WebSocket.
        """
        full = self.expand(path)
        limit = int(max_bytes) or self.MAX_DOWNLOAD_BYTES
        limit = min(limit, self.MAX_DOWNLOAD_BYTES)
        try:
            size = os.path.getsize(full)
        except OSError as exc:
            return {"path": full, "ok": False, "error": str(exc)}
        if size > limit:
            return {
                "path": full,
                "ok": False,
                "size": size,
                "error": "%d bytes exceeds the %d byte inline transfer cap"
                % (size, limit),
            }
        try:
            with open(full, "rb") as handle:
                blob = handle.read()
        except OSError as exc:
            return {"path": full, "ok": False, "error": str(exc)}
        return {
            "path": full,
            "ok": True,
            "size": len(blob),
            "name": os.path.basename(full),
            "base64": base64.b64encode(blob).decode("ascii"),
            "error": None,
        }

    def upload(self, name: str, data_base64: str, directory: str = "") -> Dict[str, Any]:
        """Materialise a dropped browser file as a real server path.

        Format dispatch is on the *name* (``importing.py:41-109``), so a blob
        has to become a file before ``cmd.load`` can see it — mirroring what
        ``pymol_gl_widget.py:256-270`` gets for free from a desktop drop.
        """
        base = os.path.basename(name or "")
        if not base:
            return {"ok": False, "error": "empty file name", "path": ""}
        target_dir = self.expand(directory) if directory else os.path.join(
            os.path.expanduser("~"), ".pymol", "uploads"
        )
        try:
            os.makedirs(target_dir, exist_ok=True)
            full = os.path.join(target_dir, base)
            with open(full, "wb") as handle:
                handle.write(base64.b64decode(data_base64 or ""))
        except (OSError, ValueError) as exc:
            return {"ok": False, "error": str(exc), "path": ""}
        return {"ok": True, "error": None, "path": full, "dir": target_dir}


#: One-shot memo of whether ``cmd.map_generate`` has ever produced an object in
#: this process.  ``None`` until something tries; see
#: :data:`MAP_GENERATE_BUILD_NOTE` for why nothing static can answer it.
_MAP_GENERATE_STATUS: Dict[str, Any] = {"tried": False, "works": None}


def _first_in(haystack: Sequence[str], *candidates: Optional[str]) -> Optional[str]:
    """``PyMOLMapLoad``'s "be nice and choose the most appropriate col"."""
    for candidate in candidates:
        if candidate and candidate in haystack:
            return candidate
    return None


def _reso_default(value: Any) -> Any:
    """``float("%3.5f" % float(v))`` or ``""`` (``PyMOLMapLoad.py:124-131``)."""
    if value is None:
        return ""
    try:
        return float("%3.5f" % float(value))
    except (TypeError, ValueError):
        return ""


def _reso_float(value: Any) -> float:
    """An empty Pmw entry field is ``''``; ``cmd.map_generate`` wants a float."""
    try:
        return float(value)
    except (TypeError, ValueError):
        return 0.0


def _entry(full: str, name: str, is_dir: bool) -> Dict[str, Any]:
    size = 0
    mtime = 0.0
    try:
        st = os.stat(full)
        size = int(st.st_size)
        mtime = float(st.st_mtime)
    except OSError:
        pass
    ext = "" if is_dir else os.path.splitext(name)[1].lstrip(".").lower()
    return {
        "name": name,
        "path": full,
        "isDir": is_dir,
        "size": size,
        "mtime": mtime,
        "ext": ext,
    }


def _matches(name: str, globs: Sequence[str]) -> bool:
    lowered = name.lower()
    for pattern in globs:
        if fnmatch.fnmatch(lowered, pattern.lower()):
            return True
    return False


def _get_assemblies(pdbid: str) -> List[str]:
    """``file_dialogs.py:409-423``, same URL, same shape."""
    import json
    import urllib.request

    pdbid = pdbid.lower()
    url = "https://www.ebi.ac.uk/pdbe/api/pdb/entry/summary/" + pdbid
    with urllib.request.urlopen(url, timeout=10) as response:
        data = json.load(response)
    return [a["assembly_id"] for a in data[pdbid][0]["assemblies"]]


def _get_chains(pdbid: str) -> List[str]:
    """``file_dialogs.py:426-441``."""
    import json
    import urllib.request

    pdbid = pdbid.lower()
    url = "https://www.ebi.ac.uk/pdbe/api/pdb/entry/polymer_coverage/" + pdbid
    with urllib.request.urlopen(url, timeout=10) as response:
        data = json.load(response)
    return [
        chain["chain_id"]
        for molecule in data[pdbid]["molecules"]
        for chain in molecule["chains"]
    ]


# --------------------------------------------------------------------------
# Installation
# --------------------------------------------------------------------------


def install(cmd: Any = None) -> Dict[str, Any]:
    """Attach the service to ``pymol.cmd`` and return :meth:`FilesAPI.hello`.

    Idempotent: a second call returns the existing instance's hello, so the
    client can bootstrap on every reconnect without leaking state (the recent
    DB handle and the PDBe cache live on the instance).
    """
    if cmd is None:
        import pymol

        cmd = pymol.cmd
    existing = getattr(cmd, ATTR, None)
    if isinstance(existing, FilesAPI):
        return existing.hello()
    api = FilesAPI(cmd)
    setattr(cmd, ATTR, api)
    return api.hello()


def uninstall(cmd: Any = None) -> bool:
    if cmd is None:
        import pymol

        cmd = pymol.cmd
    if getattr(cmd, ATTR, None) is None:
        return False
    # The tkinter shim is process-global; dropping the service without removing
    # it would leave `sys.modules['tkinter.filedialog']` pointing at a broker
    # nobody can answer any more.
    uninstall_tk_filedialog()
    delattr(cmd, ATTR)
    return True


def installed(cmd: Any = None) -> bool:
    if cmd is None:
        import pymol

        cmd = pymol.cmd
    return isinstance(getattr(cmd, ATTR, None), FilesAPI)
