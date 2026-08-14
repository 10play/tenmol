---
name: get_movie_length
kind: command
category: movies-scenes-states
subcategory: movie query
summary: Returns the number of frames explicitly defined in the movie.
parity: implemented
---

## Purpose
`get_movie_length` returns how many frames are explicitly defined in the movie (via `mset`/`mview`), not counting molecular states implicitly. Use it to size the movie timeline or decide whether an explicit movie exists.

## Syntax
`get_movie_length(quiet=1, images=-1)`

| Param | Type | Default | Meaning |
| --- | --- | --- | --- |
| `quiet` | 0/1 | `1` | If `0`, prints the frame count |
| `images` | int | `-1` | Controls how the signed raw length is interpreted (see Behaviour) |

## Behaviour
Calls `_cmd.get_movie_length`, which may return a negative raw value encoding "images not cached". The `images` argument then maps it: with `images=0` a negative raw becomes `0`; with `images<0` (default) a negative raw is negated to a positive count; with `images=1` a positive raw becomes `0`. When the resolved value is `>=0` and `quiet=0`, prints `cmd.get_movie_length: <n> frames`.

## Examples
```python
n = cmd.get_movie_length()
cmd.get_movie_length(quiet=0)
```

## Related
- [count_frames](../commands/count_frames.md)
- [count_states](../commands/count_states.md)
- [get_frame](./get_frame.md)

## Source
`packages/engine/modules/pymol/querying.py:730`. Parity: implemented in `packages/engine-ts/src/cmd/movie3.ts`.
