"""Parity area 12 — the two build facts a client author can get wrong.

Both rows carried a `†` citation only, and neither cited test touched a build
fact: ``apps/web/src/features/texteditor/syntax.test.ts`` is a syntax
highlighter, ``conftest.py`` is a fixture module, and
``test_geometry_exports.py`` exports geometry.  Nothing in the corpus asserted
that ``pymol._cmd`` is a COMPILED extension carrying the nine C entry points
the bridge sits on, and nothing asserted that ``CMakeLists.txt`` cannot be
driven standalone.

These tests are about the SHIPPED artefact and the build inputs, so they need
no PyMOL session and no bridge — they run in milliseconds and are safe in CI on
a machine that never builds.

Run::

    packages/bridge/.venv/bin/python -m pytest packages/bridge/tests/test_p13_build_tooling.py -q
"""

from __future__ import annotations

import importlib.machinery
import re
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parents[3]
ENGINE = REPO / "packages" / "engine"
SETUP_PY = ENGINE / "setup.py"
PYPROJECT = ENGINE / "pyproject.toml"
CMAKELISTS = ENGINE / "CMakeLists.txt"

#: ``_cmd._new/_start/_stop/_idle/_getRedisplay/_reshape/_draw/_button/_drag``
#: — the row's words.  ``tenmol_bridge`` drives PyMOL through exactly these.
C_ENTRY_POINTS = (
    "_new",
    "_start",
    "_stop",
    "_idle",
    "_getRedisplay",
    "_reshape",
    "_draw",
    "_button",
    "_drag",
)

#: Every variable ``CMakeLists.txt`` uses.  The row's claim is that setup.py
#: injects all of them as ``-D`` flags and CMake defines none of them itself.
INJECTED_VARS = (
    "TARGET_NAME",
    "ALL_SRC",
    "ALL_INC_DIR",
    "ALL_DEF",
    "ALL_LIB",
    "ALL_LIB_DIR",
    "ALL_COMP_ARGS",
    "ALL_EXT_LINK",
    "SHARED_SUFFIX",
)


# =========================================================================== #
# row: pip/setup.py build path (the only real build)
# =========================================================================== #


def test_pymol_cmd_is_a_compiled_extension_not_a_python_shim() -> None:
    """The build produced a CPython extension, and the tests are running it.

    Worth pinning because every other assertion in this corpus would still pass
    against a pure-Python stand-in: ``import pymol`` succeeding proves nothing
    about whether the C++ half was built at all.
    """
    import pymol._cmd as _cmd

    suffix = next(
        (s for s in importlib.machinery.EXTENSION_SUFFIXES if _cmd.__file__.endswith(s)),
        None,
    )
    assert suffix is not None, "pymol._cmd is %s, not an extension module" % _cmd.__file__
    assert not _cmd.__file__.endswith(".py")


@pytest.mark.parametrize("name", C_ENTRY_POINTS)
def test_the_nine_c_entry_points_the_bridge_sits_on_exist(name: str) -> None:
    """`_new/_start/_stop/_idle/_getRedisplay/_reshape/_draw/_button/_drag`.

    Each must be a C function on the extension, not a Python wrapper on
    ``cmd`` — the bridge's pump and frame stream call them directly
    (``layer4/Cmd.cpp``'s method table), so a rename upstream is a hard break
    and this is where it should surface.
    """
    import pymol._cmd as _cmd

    assert hasattr(_cmd, name), "pymol._cmd has no %s" % name
    fn = getattr(_cmd, name)
    assert type(fn).__name__ == "builtin_function_or_method", (name, type(fn))


def test_the_build_also_produces_the_second_extension_chempy_champ() -> None:
    """``setup.py`` declares TWO ``CMakeExtension``\\ s and a client that only
    checks ``pymol._cmd`` would not notice the other one failing to build.

    ``chempy.champ._champ`` is what ``cmd.fragment`` / the builder's SMILES
    path needs.
    """
    import chempy.champ._champ as champ

    assert any(
        champ.__file__.endswith(s) for s in importlib.machinery.EXTENSION_SUFFIXES
    ), champ.__file__


def test_pyproject_declares_the_pep_517_chain_that_runs_setup_py() -> None:
    """``pip install .`` is the ONE real build path, and this is why.

    A ``[build-system]`` with an in-tree backend plus cmake in ``requires`` is
    what makes ``pip install .`` drive setup.py drive CMake.  Someone who
    "simplified" this to the default setuptools backend would silently lose the
    CMake step.
    """
    text = PYPROJECT.read_text()
    assert "[build-system]" in text
    assert re.search(r'^build-backend\s*=\s*"backend"', text, re.M), (
        "the in-tree PEP 517 backend is gone"
    )
    assert re.search(r'^backend-path\s*=\s*\["_custom_build"\]', text, re.M)
    assert re.search(r'"cmake>=', text), "cmake is not a build requirement"
    assert (ENGINE / "_custom_build" / "backend.py").is_file()


def test_setup_py_is_what_shells_out_to_cmake() -> None:
    """Not a CMake project with a setup.py wrapper: a setup.py that runs CMake.

    ``build_ext_pymol`` is registered as the ``build_ext`` command and it is
    the thing that invokes ``cmake``.  Both extensions are ``CMakeExtension``.
    """
    text = SETUP_PY.read_text()
    assert '"build_ext": build_ext_pymol' in text
    assert re.search(r'self\.spawn\(\["cmake", str\(cwd\)\] \+ cmake_args\)', text), (
        "setup.py no longer configures cmake"
    )
    assert re.search(r'self\.spawn\(\["cmake", "--build", "\."\] \+ build_args\)', text), (
        "setup.py no longer builds with cmake"
    )
    assert text.count("CMakeExtension(") >= 2, "the two extensions are not both CMake"


# =========================================================================== #
# row: CMakeLists.txt is a stub, not a standalone build
# =========================================================================== #


def test_cmakelists_is_a_stub_of_a_few_dozen_lines() -> None:
    """31 lines when the row was written.  A hard equality would be noise, but
    an order of magnitude is the claim: this file is not where the build lives.
    """
    lines = [l for l in CMAKELISTS.read_text().splitlines()]
    assert len(lines) < 60, "CMakeLists.txt is %d lines; it is no longer a stub" % len(
        lines
    )
    assert "project(${TARGET_NAME})" in CMAKELISTS.read_text()


@pytest.mark.parametrize("var", INJECTED_VARS)
def test_every_cmake_variable_is_used_but_never_defined_locally(var: str) -> None:
    """The reason ``cmake ..`` standalone cannot work.

    Each variable is dereferenced as ``${VAR}`` and there is no ``set(VAR ...)``
    or ``option(VAR ...)`` anywhere in the file, so its only possible source is
    a ``-D`` on the command line.
    """
    text = CMAKELISTS.read_text()
    assert "${%s}" % var in text, "%s is no longer used by CMakeLists.txt" % var
    assert not re.search(r"^\s*(set|option)\s*\(\s*%s\b" % re.escape(var), text, re.M), (
        "%s is defined inside CMakeLists.txt, so the file is no longer a stub "
        "that only setup.py can drive" % var
    )


@pytest.mark.parametrize("var", INJECTED_VARS)
def test_setup_py_injects_every_one_of_them_as_a_minus_D_flag(var: str) -> None:
    """The other half of the same fact: ``cmake_args`` is the whole interface.

    If setup.py stopped passing one of these, CMake would expand it to the
    empty string and produce a library with, say, no compile definitions —
    a build that succeeds and a PyMOL that misbehaves.
    """
    text = SETUP_PY.read_text()
    assert re.search(r'f?"-D%s=' % re.escape(var), text), (
        "setup.py does not inject -D%s; CMakeLists.txt dereferences it and "
        "would get an empty value" % var
    )


def test_the_cmake_variables_and_the_minus_D_flags_are_the_same_set() -> None:
    """No drift in either direction, checked as sets rather than one by one.

    A variable added to CMakeLists.txt and not to setup.py is a silent empty
    expansion; one added to setup.py and not to CMakeLists.txt is dead weight
    that hides the first kind.
    """
    cmake_text = CMAKELISTS.read_text()
    used = set(re.findall(r"\$\{([A-Z][A-Z0-9_]*)\}", cmake_text))
    # CMake's own variables are not setup.py's business.
    used -= {v for v in used if v.startswith("CMAKE_")}
    injected = set(re.findall(r'"-D([A-Z][A-Z0-9_]*)=', SETUP_PY.read_text()))
    injected -= {v for v in injected if v.startswith("CMAKE_")}
    assert used == set(INJECTED_VARS), sorted(used)
    assert used == injected, {
        "only in CMakeLists.txt": sorted(used - injected),
        "only in setup.py": sorted(injected - used),
    }
