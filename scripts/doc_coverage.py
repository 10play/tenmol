"""Docstring coverage for the Python bridge, as JSON on stdout.

    python3 scripts/doc_coverage.py packages/bridge/tenmol_bridge

Pure stdlib (`ast`) — no venv, no PyMOL — so it runs on the CI runner's system
python3 exactly like tools/parity/drain_lint.py. The companion
`scripts/doc-coverage.mjs` calls this and folds the count into the combined
ratchet gate.

"Public" means a module, class, or def whose name does not start with `_`
(dunder methods included as private). A symbol is documented when it carries a
docstring. Test files and `__main__` are out of scope, matching the TypeScript
side which excludes tests.
"""

from __future__ import annotations

import ast
import json
import os
import sys


def _is_public(name: str) -> bool:
    return not name.startswith("_")


def _iter_defs(node: ast.AST):
    """Yield public class/function defs, recursing into class bodies."""
    for child in ast.iter_child_nodes(node):
        if isinstance(child, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
            if _is_public(child.name):
                yield child
            if isinstance(child, ast.ClassDef):
                yield from _iter_defs(child)


def scan_file(path: str) -> tuple[int, int, list[str]]:
    with open(path, encoding="utf-8") as fh:
        source = fh.read()
    tree = ast.parse(source, filename=path)

    total = 0
    documented = 0
    missing: list[str] = []

    # module docstring
    total += 1
    if ast.get_docstring(tree):
        documented += 1
    else:
        missing.append(f"{path}: module")

    for node in _iter_defs(tree):
        total += 1
        if ast.get_docstring(node):
            documented += 1
        else:
            missing.append(f"{path}:{node.lineno}: {node.name}")

    return total, documented, missing


def main(argv: list[str]) -> int:
    roots = argv[1:] or ["packages/bridge/tenmol_bridge"]
    total = 0
    documented = 0
    missing: list[str] = []

    for root in roots:
        for dirpath, _dirs, files in os.walk(root):
            for name in sorted(files):
                if not name.endswith(".py"):
                    continue
                if name.startswith("test_") or name == "__main__.py":
                    continue
                t, d, m = scan_file(os.path.join(dirpath, name))
                total += t
                documented += d
                missing.extend(m)

    json.dump(
        {
            "lang": "python",
            "total": total,
            "documented": documented,
            "undocumented": total - documented,
            "missing": missing,
        },
        sys.stdout,
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
