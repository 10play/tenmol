# Rule: Must have full parity with PyMOL

All molecular viewer features exposed in the UI must have corresponding parity
with native PyMOL behavior and commands. tenmol is a web client for PyMOL —
it must not silently diverge from what PyMOL does.

**What parity means:**
- Visual output (colors, representations, selection highlights) must match PyMOL's defaults
- Commands sent over the WebSocket bridge must produce the same result as the equivalent
  PyMOL CLI command (e.g. `color red, chain A` → same residues colored)
- Selection syntax must map 1-to-1 to PyMOL selection algebra (and/or/not, residue ranges, etc.)
- Structure loading and parsing must respect the same PDB/mmCIF/SDF handling as PyMOL

**What to check in a PR:**
- If the PR modifies bridge commands or rendering logic, verify the PyMOL command mapping
  is documented in the diff or in a comment
- If a new representation or selection mode is introduced, confirm it has been tested
  against PyMOL output (screenshot comparison or assertion on bridge output)
- If tenmol deviates intentionally (e.g. UI affordance not in PyMOL), it must be flagged
  with a `// tenmol-only:` comment in the code and noted in the PR description

**Enforcement:**
Any undocumented divergence from PyMOL behavior = 🔴 Critical.
Missing bridge-command documentation for a new feature = 🟡 Major.
