---
name: get_movie_locked
kind: command
category: movies-scenes-states
subcategory: movie query
summary: Returns whether the movie is currently locked against playback/updates.
parity: unknown
---

## Purpose
`get_movie_locked` reports the movie lock state — whether the movie timeline is currently locked (e.g. during an operation that must not advance frames). It is a low-level state query used by the movie/playback machinery.

## Syntax
`get_movie_locked()`

Takes no positional arguments (only the internal `_self`).

## Behaviour
Locks the command layer and returns `_cmd.get_movie_locked`, a boolean/integer lock flag. No engine docstring is present.

## Examples
```python
locked = cmd.get_movie_locked()
```

## Related
- [get_movie_playing](./get_movie_playing.md)
- [get_movie_length](./get_movie_length.md)

## Source
`packages/engine/modules/pymol/querying.py:814`. Parity: no TypeScript port found; parityStatus unknown.
