# PyMOL feature graph — index

Start here to navigate the deep-dive docs. The flat feature list is in [`MANIFEST.md`](./MANIFEST.md)
(or [`manifest.json`](./manifest.json) for tooling). See [`README.md`](./README.md) for how it's built.

## Commands (424 docs)

One file per `cmd.*` command under [`features/commands/`](./features/commands/). Browse them via the
[commands section of MANIFEST.md](./MANIFEST.md), which groups every command by category.

## Settings (779)

Grouped by prefix family across four batch docs — the whole `set` / `get` namespace:

- [`features/settings/_batch-00.md`](./features/settings/_batch-00.md)
- [`features/settings/_batch-01.md`](./features/settings/_batch-01.md)
- [`features/settings/_batch-02.md`](./features/settings/_batch-02.md)
- [`features/settings/_batch-03.md`](./features/settings/_batch-03.md)

## Feature domains (`features/topics/`)

| Domain | Doc |
| --- | --- |
| Representations (lines, sticks, spheres, cartoon, surface, mesh, dots, …) | [representations.md](./features/topics/representations.md) |
| Selection algebra (property/logical/proximity operators, macros) | [selection-algebra.md](./features/topics/selection-algebra.md) |
| Coloring system (color, spectrum, palettes, schemes) | [coloring-system.md](./features/topics/coloring-system.md) |
| Named colors (all 178) | [named-colors.md](./features/topics/named-colors.md) |
| Wizards (measurement, mutagenesis, pair-fit, …) | [wizards.md](./features/topics/wizards.md) |
| Presets (simple, technical, publication, ligand sites, …) | [presets.md](./features/topics/presets.md) |
| Movies, scenes, states & camera | [movies-scenes-states.md](./features/topics/movies-scenes-states.md) |
| Maps, volumes & isosurfaces | [maps-volumes.md](./features/topics/maps-volumes.md) |
| Structure editing & the Builder | [editing-building.md](./features/topics/editing-building.md) |
| Sculpting & minimization | [sculpting-minimization.md](./features/topics/sculpting-minimization.md) |
| Symmetry & crystallography | [symmetry-crystallography.md](./features/topics/symmetry-crystallography.md) |
| Alignment & superposition | [fitting-alignment.md](./features/topics/fitting-alignment.md) |
| Rendering, ray tracing & export | [rendering-export.md](./features/topics/rendering-export.md) |
| File I/O & formats | [file-formats.md](./features/topics/file-formats.md) |
| Querying, iteration & properties | [querying-properties.md](./features/topics/querying-properties.md) |
| Viewing & camera control | [viewing-camera.md](./features/topics/viewing-camera.md) |
| GUI shell & internal OpenGL GUI | [ui-main-internal.md](./features/topics/ui-main-internal.md) |
| Mouse/keyboard input & dialogs | [ui-input-dialogs.md](./features/topics/ui-input-dialogs.md) |

## Parity snapshot

`parityStatus` on each row reflects the TypeScript engine (`packages/engine-ts`) and
`docs/feature-parity.md`. Across all 1,643 features:

| Status | Count | Meaning |
| --- | --- | --- |
| `implemented` | 701 | present in the parity port |
| `partial` | 72 | partially ported |
| `planned` | 70 | not yet ported |
| `internal` | 76 | internal/helper, not a user feature |
| `unknown` | 724 | mostly the raw setting namespace, not individually classified |

Regenerate after edits: `pnpm --filter @tenmol/graph build:manifest`.
