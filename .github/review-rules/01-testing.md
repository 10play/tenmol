# Rule: Every new piece of code must be tested

Every new function, component, hook, or utility introduced in a PR must be accompanied
by at least one unit test that covers its primary behavior.

**Applies to:**
- New React components (render + key interactions)
- New hooks (behavior under state changes)
- New utility/helper functions (expected inputs → outputs)
- New API endpoints or WebSocket handlers

**Exemptions:**
- Trivial pass-through wrappers with no logic
- Generated/auto-scaffolded boilerplate (mark explicitly with a comment)

**Enforcement:**
Flag any new file without a corresponding test as a 🔴 Critical issue.
If a test file exists but the new code path is not covered, flag as 🟡 Major.
