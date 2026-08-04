"""Dump the live `cmd` API as JSON, from INSIDE a running PyMOL.

    packages/bridge/.venv/bin/python tools/gen-api/extract.py > tools/gen-api/api-schema.json

WHY IT HAS TO RUN INSIDE PYMOL. `packages/engine/modules/pymol/api.py` is a re-export manifest
with no function bodies (405 import entries, 404 unique — asserted in
`packages/bridge/tests/test_api_surface.py`), so parsing it statically yields names and
nothing else. Signatures, defaults and docstrings live in the modules it
imports from, and several are wrapped by decorators that only `inspect.unwrap`
sees through. Importing PyMOL is the cheap way to get all of it correct.

WHAT IS DELIBERATELY NOT DECIDED HERE. This writes FACTS — parameter names,
kinds, defaults, annotations, docstring argument lines, and the domain tables.
It does not decide TypeScript types. That belongs in the emitter, where the
priority order (annotation > auto_arg domain > default type > docstring >
name heuristic > fallback) can be changed without re-running PyMOL.
"""

from __future__ import annotations

import inspect
import json
import re
import sys
from typing import Any, Dict, List, Optional

#: Parameters every command carries that the client must never see.
DROPPED_PARAMS = ("_self",)

#: `ARGUMENTS` lines look like `name = int: description {default: x}`.
_ARG_LINE = re.compile(r"^\s*(\w+)\s*=\s*([\w/|]+)\s*:\s*(.*)$")


def _default_repr(value: Any) -> Optional[str]:
    """`repr()`, but never something that changes between runs.

    A default that is an object prints its ADDRESS, which would make the schema
    differ on every extraction and turn the CI drift check into noise.
    """
    if value is inspect.Parameter.empty:
        return None
    text = repr(value)
    return "<opaque>" if " at 0x" in text else text


def _annotation(param: inspect.Parameter) -> Optional[str]:
    if param.annotation is inspect.Parameter.empty:
        return None
    annotation = param.annotation
    return getattr(annotation, "__name__", None) or str(annotation)


def describe_parameters(fn: Any) -> Optional[List[Dict[str, Any]]]:
    """One entry per parameter, `_self` removed. None if not introspectable."""
    try:
        signature = inspect.signature(inspect.unwrap(fn))
    except (TypeError, ValueError):
        return None

    out: List[Dict[str, Any]] = []
    for name, param in signature.parameters.items():
        if name in DROPPED_PARAMS:
            continue
        out.append(
            {
                "name": name,
                "kind": param.kind.name,
                "hasDefault": param.default is not inspect.Parameter.empty,
                "default": _default_repr(param.default),
                "annotation": _annotation(param),
            }
        )
    return out


def docstring_arguments(doc: Optional[str]) -> Dict[str, Dict[str, str]]:
    """`{name: {type, description}}` from the ARGUMENTS section.

    Same uppercase-section walk `cmd.write_html_ref` uses: a line that is a
    bare uppercase word starts a section. Only ARGUMENTS is read; DESCRIPTION
    and SEE ALSO are carried whole for the emitter to put in JSDoc.
    """
    if not doc:
        return {}
    section = ""
    found: Dict[str, Dict[str, str]] = {}
    for line in doc.splitlines():
        stripped = line.strip()
        if stripped and stripped == stripped.upper() and stripped.replace(" ", "").isalpha():
            section = stripped
            continue
        if section != "ARGUMENTS":
            continue
        match = _ARG_LINE.match(line)
        if match:
            found[match.group(1)] = {
                "type": match.group(2),
                "description": match.group(3).strip(),
            }
    return found


def docstring_sections(doc: Optional[str]) -> Dict[str, str]:
    """DESCRIPTION and SEE ALSO, for JSDoc."""
    if not doc:
        return {}
    section = ""
    buckets: Dict[str, List[str]] = {}
    for line in doc.splitlines():
        stripped = line.strip()
        if stripped and stripped == stripped.upper() and stripped.replace(" ", "").isalpha():
            section = stripped
            buckets.setdefault(section, [])
            continue
        if section:
            buckets.setdefault(section, []).append(line.rstrip())
    out = {}
    for key in ("DESCRIPTION", "SEE ALSO"):
        if key in buckets:
            text = "\n".join(buckets[key]).strip()
            if text:
                out[key] = text
    return out


def extract(cmd: Any) -> Dict[str, Any]:
    commands: Dict[str, Any] = {}
    skipped: Dict[str, str] = {}

    for name in sorted(dir(cmd)):
        if name.startswith("_"):
            continue
        try:
            value = getattr(cmd, name)
        except Exception as exc:  # noqa: BLE001 - an attribute that raises
            skipped[name] = "getattr raised: %s" % type(exc).__name__
            continue
        if not callable(value):
            skipped[name] = "not callable"
            continue

        params = describe_parameters(value)
        if params is None:
            skipped[name] = "no introspectable signature"
            continue

        doc = inspect.getdoc(value)
        commands[name] = {
            "params": params,
            "docArguments": docstring_arguments(doc),
            "sections": docstring_sections(doc),
        }

    return {
        "commands": commands,
        "skipped": skipped,
        "domains": domains(cmd),
    }


def domains(cmd: Any) -> Dict[str, Any]:
    """The value sets the emitter turns into string-literal unions."""
    out: Dict[str, Any] = {}

    try:
        from pymol import keywords

        out["keywordModes"] = sorted(keywords.get_command_keywords())
    except Exception:  # noqa: BLE001
        out["keywordModes"] = []

    try:
        from pymol import setting

        out["settings"] = sorted(setting.get_name_list())
    except Exception:  # noqa: BLE001
        out["settings"] = []

    try:
        out["colors"] = sorted(name for name, _ in cmd.get_color_indices())
    except Exception:  # noqa: BLE001
        out["colors"] = []

    # `auto_arg` position -> {command: type_name}. The TYPE NAME is what the
    # emitter brands (`selection`, `object`, ...); the shortcut/lambda itself
    # is deliberately not captured — half of them are re-evaluated per
    # completion and mean nothing outside a live session.
    try:
        out["autoArgTypes"] = [
            {command: entry[1] for command, entry in table.items() if len(entry) > 1}
            for table in cmd.auto_arg
        ]
    except Exception:  # noqa: BLE001
        out["autoArgTypes"] = []

    return out


def main() -> int:
    sys.argv = ["pymol"]
    import pymol

    if pymol.cmd._COb is None:
        options = pymol.invocation.options
        options.no_gui = 1
        options.quiet = 1
        from pymol2 import SingletonPyMOL

        instance = SingletonPyMOL()
        instance.start()

    schema = extract(pymol.cmd)
    json.dump(schema, sys.stdout, indent=1, sort_keys=True)
    sys.stdout.write("\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
