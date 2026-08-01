"""File I/O data feed — the server-side half of parity area 6 (WP-18).

Everything PyMOL loads or saves is a **server-side path string**.
``cmd.load`` runs the name through ``_self.exp_path`` (``modules/pymol/
importing.py:751``) and hands the *path* to C; ``cmd.save`` does the same
(``modules/pymol/exporting.py:836-838``); format dispatch is on the extension,
not the content (``importing.py:41-109``).  A browser ``File`` blob has no
path, so the web client cannot use a native file dialog — it needs a
**server-side path browser rendered in React**, which is what this module
feeds.  That is the recommendation of ``docs/webclient/file-io.md`` §0 and it
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
(``modules/pymol/parser.py``), so that is a single round trip and the module
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
    "SESSION_FILTERS",
    "GEOMETRY_EXPORTS",
    "LOG_FILTERS",
    "RUN_FILTERS",
    "MOVIE_FILTERS",
    "PNG_RENDERING_MODES",
    "MAE_MULTIPLEX_CHOICES",
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


def _re_ext_from_filter(filter_text: str) -> Optional[str]:
    """``getSaveFileNameWithExt``'s regex (``pymol/Qt/utils.py:240-244``)."""
    match = re.search(r"\*(\.[\w\.]+)", filter_text or "")
    return match.group(1) if match else None


def with_extension(fname: str, filter_text: str) -> str:
    """``getSaveFileNameWithExt`` (``modules/pymol/Qt/utils.py:229-246``).

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
    (``modules/pymol2/__init__.py:53-55``), the bridge comes up DEGRADED and
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

    # Honest about the formats that raise in this open-source build
    # (`incentive_only.py`): mae, mtz, stl, gltf/glb.
    dotted = "." + (ext or "")
    if dotted in UNAVAILABLE_FORMATS:
        info["unavailable"] = UNAVAILABLE_FORMATS[dotted]
    elif fmt and ("." + fmt) in UNAVAILABLE_FORMATS:
        info["unavailable"] = UNAVAILABLE_FORMATS["." + fmt]
    elif fmt in ("vis", "moe", "phypo"):
        info["unavailable"] = (
            "'%s' format is Incentive-only and raises in this build "
            "(modules/pymol/importing.py:1641-1643)" % fmt
        )
    return info


class _RecentDB:
    """PyMOL's own recent-files code, borrowed rather than reimplemented.

    ``PyMOLDesktopGUI._recent_filenames_lazy_init`` / ``recent_filenames`` /
    ``recent_filenames_add`` (``modules/pymol/_gui.py:975-1032``) only touch
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
            "loadFormats": self.load_formats(),
            "saveFormats": self.save_formats(),
        }

    def unavailable(self) -> Dict[str, str]:
        """Extensions that raise in this build (``incentive_only.py``)."""
        from ..incentive_only import UNAVAILABLE_FORMATS

        return dict(UNAVAILABLE_FORMATS)

    def load_formats(self) -> List[str]:
        """``importing.loadfunctions`` keys — the python-handled loaders."""
        from pymol import importing

        return sorted(importing.loadfunctions)

    def save_formats(self) -> List[str]:
        """``exporting.savefunctions`` keys, plus the ``func_type4`` set."""
        from pymol import exporting

        extra = ["mmd", "out", "dat", "pkl", "pkla"]
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

    # ------------------------------------------------------------ saving

    def with_ext(self, fname: str, filter_text: str) -> str:
        return with_extension(fname, filter_text)

    def save_check(self, fname: str, filter_text: str = "") -> Dict[str, Any]:
        """Validate a save target before ``cmd.save`` throws.

        ``cmd.save`` raises "Unrecognized file format" on an unknown extension
        (``exporting.py:836-843``) despite what its docstring claims, so the
        picker checks first.
        """
        from pymol import exporting, importing

        from ..incentive_only import UNAVAILABLE_FORMATS

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
            "unavailable": UNAVAILABLE_FORMATS.get("." + (fmt or ext or "")),
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
        (``modules/pymol/movie.py:770-800``) and passes no ``stdin``, so
        ``ffmpeg`` inherits the server's descriptor 0 and consumes it — the
        server then sees its own stdin closed and shuts down.  Observed twice
        end to end: uvicorn logged ``Shutting down`` on the line after
        ``produce: finished.``, the browser dropped to the reconnect overlay,
        and the same command with ``< /dev/null`` survived.

        Redirecting fd 0 (not ``sys.stdin``) is what it takes, because the
        child inherits the *descriptor*, not the Python object.  PyMOL's own
        source is off limits to this work package, so the guard lives here.
        """
        from pymol import movie

        devnull = os.open(os.devnull, os.O_RDONLY)
        saved = os.dup(0)
        try:
            os.dup2(devnull, 0)
            movie.produce(self.expand(filename), _self=self.cmd, **kwargs)
        except Exception as exc:  # noqa: BLE001
            return {"ok": False, "error": str(exc), "path": self.expand(filename)}
        finally:
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
        ``layer1/Setting.cpp:644``; ``fetch_host`` (default ``"pdb"``) and
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
    delattr(cmd, ATTR)
    return True


def installed(cmd: Any = None) -> bool:
    if cmd is None:
        import pymol

        cmd = pymol.cmd
    return isinstance(getattr(cmd, ATTR, None), FilesAPI)
