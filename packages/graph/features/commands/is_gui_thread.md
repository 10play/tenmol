---
name: is_gui_thread
kind: command
category: internal
subcategory: threading
summary: Return True if the caller runs on the GUI thread (or there is no GUI thread).
parity: internal
---

## Purpose
Internal threading helper. PyMOL restricts certain GL/GUI operations to the main graphics thread;
`is_gui_thread` lets internal code decide whether it may act directly or must marshal work onto
the GUI thread.

## Syntax
`is_gui_thread()`

## Behaviour
Reads `_self._pymol.glutThread` (the identifier of the GUI/GLUT/Qt thread). Returns True when that
identifier is `None` (no GUI thread exists — e.g. headless/library mode) or equals the current
thread's id; otherwise False. Marked `# internal` in source and performs no locking.

## Examples
```python
from pymol import cmd
if cmd.is_gui_thread():
    ...  # safe to touch GL state directly
```

## Related
None.

## Source
`packages/engine/modules/pymol/locking.py:80`. Parity: not ported to engine-ts (the TS engine has
no GLUT/Qt thread model).
