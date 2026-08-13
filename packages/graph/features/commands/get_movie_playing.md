---
name: get_movie_playing
kind: command
category: movies-scenes-states
subcategory: movie query
summary: Returns a boolean indicating whether the movie is currently playing.
parity: implemented
---

## Purpose
`get_movie_playing` returns whether the movie is currently playing back. Use it to poll playback state (there is no change event in the core) for UI or to gate operations that should not run mid-playback.

## Syntax
`get_movie_playing()`

Takes no positional arguments (only the internal `_self`).

## Behaviour
Locks the command layer and returns the boolean result of `_cmd.get_movie_playing`; raises `CmdException` on error. Because the C core has no notification bus, GUIs poll this alongside `get_frame`/`get_state` to track playback.

## Examples
```python
if cmd.get_movie_playing():
    cmd.mstop()
```

## Related
- [mplay](../commands/mplay.md)
- [mstop](../commands/mstop.md)
- [get_frame](./get_frame.md)

## Source
`packages/engine/modules/pymol/moving.py:64`. Parity: implemented in `packages/engine-ts/src/cmd/system.ts`.
