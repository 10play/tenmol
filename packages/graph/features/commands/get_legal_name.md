---
name: get_legal_name
kind: command
category: objects-groups
subcategory: naming
summary: Sanitizes a candidate string into a legal PyMOL object/selection name.
parity: unknown
---

## Purpose
`get_legal_name` converts an arbitrary string into a name that is legal for a PyMOL object or selection, stripping or replacing characters that would break selection-language parsing. Useful when generating object names from filenames or user input.

## Syntax
`get_legal_name(name)`

| Param | Type | Default | Meaning |
| --- | --- | --- | --- |
| `name` | str | (required) | Candidate name to sanitize |

## Behaviour
Locks the command layer and returns the sanitized string from `_cmd.get_legal_name`. Illegal characters (e.g. those with special meaning in selection expressions) are removed or replaced so the result can safely name an object. No engine docstring is present.

## Examples
```python
safe = cmd.get_legal_name("my file (1).pdb")
```

## Related
- [get_unused_name](../commands/get_unused_name.md)
- [set_name](../commands/set_name.md)

## Source
`packages/engine/modules/pymol/querying.py:1201`. Parity: no TypeScript port found; parityStatus unknown.
