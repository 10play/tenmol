---
name: fitting-alignment
kind: feature
category: fitting-alignment
subcategory: superposition & alignment
summary: PyMOL's structural-superposition and sequence-alignment verbs — align/super/cealign/usalign, the fit/rms family, intra-object state fitting, pair_fit, the extra_fit/alignto batch wrappers, the raw-alignment accessors, and morph.
parity: partial
---

## Purpose

Fitting and alignment commands answer "how similar are these two structures, and where do I put one so it
lands on the other?" They range from pure measurement (`rms_cur`, `rms`, `intra_rms`) through rigid
least-squares superposition (`fit`, `pair_fit`, `intra_fit`) up to full sequence-plus-structure aligners
(`align`, `super`, `cealign`, `usalign`) and the batch wrappers (`extra_fit`, `alignto`). All rigid fits use a
Kabsch/SVD least-squares rotation; the aligners differ only in *how atom pairs are chosen* before that fit —
by sequence identity, by structural correspondence, or by TM-score optimisation. `morph` is the odd one out:
it interpolates *between* two conformations rather than superposing them.

## Syntax

Every command below shares the same rigid-superposition core (Kabsch: centroid-align both point sets, build
the 3x3 covariance, SVD, determinant sign-fix, apply the rotation to the whole mobile object). What varies is
the **pairing rule** and whether the transform is applied. See each section for its exact signature and params.

The choice of aligner by sequence identity:

| Identity | Recommended | Pairs atoms by |
| --- | --- | --- |
| > 30% | `align` | dynamic-programming sequence alignment |
| low / none | `super` | residue-based + secondary/tertiary structure |
| low / none | `cealign` | CE combinatorial extension (structure only) |
| different lengths | `usalign` | TM-score optimisation (length-independent) |

---

## align

`align` performs a **sequence alignment** followed by a structural superposition, then zero or more cycles of
refinement to reject structural outliers. It does well on proteins with decent sequence similarity
(identity > 30%); for lower identity, prefer `super` or `cealign`.

| Param | Type | Default | Meaning |
| --- | --- | --- | --- |
| `mobile` | string | | atom selection of mobile object (moved) |
| `target` | string | | atom selection of target object (fixed) |
| `cutoff` | float | `2.0` | outlier-rejection cutoff in Å |
| `cycles` | int | `5` | max outlier-rejection cycles |
| `gap` | float | `-10.0` | sequence-alignment gap-open penalty |
| `extend` | float | `-0.5` | sequence-alignment gap-extend penalty |
| `max_gap` | int | `50` | max gap length |
| `object` | string | `None` | name of alignment object to create |
| `matrix` | string | `'BLOSUM62'` | substitution-matrix file for the sequence step |
| `mobile_state` | int | `0` | mobile object state (`0` = all states) |
| `target_state` | int | `0` | target object state (`0` = all states) |
| `quiet` | int | `1` | suppress text output |
| `max_skip` | int | `0` | max residues to skip |
| `transform` | 0/1 | `1` | apply the superposition (`0` = measure only) |
| `reset` | int | `0` | delete any existing alignment object first |

### Behaviour

The reported RMSD is over the aligned atoms **after** outlier rejection. To get the all-atom RMSD (no
rejection), set `cycles=0`. If `object` is given, an alignment object is created that pairs atoms and drives
the sequence viewer. `matrix` is resolved as a literal path, else looked up under
`$PYMOL_DATA/pymol/matrices/`; `'none'`/`''` disables the substitution matrix. Returns the list
`[rmsd, n_atoms, n_cycles, rmsd_pre, n_pre, raw_score, n_res]`.

### Examples

```
align protA////CA, protB////CA, object=alnAB
align mobile, target, cycles=0        # all-atom RMSD, no outlier rejection
```

### Related

[super](fitting-alignment.md#super), [cealign](fitting-alignment.md#cealign), [fit](fitting-alignment.md#fit)

### Source

`packages/engine/modules/pymol/fitting.py:372`; `docs/api-reference/commands.mdx:45`. Parity:
`packages/engine-ts/src/cmd/align.ts:499` — the TS port substitutes a greedy longest-common-subsequence Cα
pairing for PyMOL's DP aligner and does **not** run refinement cycles (`n_cycles` is always 0).

---

## super

`super` performs a **residue-based** pairwise alignment (weighting sequence *and* secondary/tertiary
structure and current coordinates) followed by superposition and outlier-rejection cycles. It is more robust
than `align` at low sequence identity.

| Param | Type | Default | Meaning |
| --- | --- | --- | --- |
| `mobile` | string | | mobile selection |
| `target` | string | | target selection |
| `cutoff` | float | `2.0` | outlier-rejection cutoff in Å |
| `cycles` | int | `5` | max refinement cycles |
| `gap` | float | `-1.5` | gap-open penalty |
| `extend` | float | `-0.7` | gap-extend penalty |
| `max_gap` | int | `50` | max gap length |
| `object` | string | `None` | alignment object to create |
| `matrix` | string | `'BLOSUM62'` | substitution matrix |
| `mobile_state` | int | `0` | mobile state |
| `target_state` | int | `0` | target state |
| `quiet` | int | `1` | suppress output |
| `max_skip` | int | `0` | max skip |
| `transform` | 0/1 | `1` | apply superposition |
| `reset` | int | `0` | reset existing alignment object |
| `seq` | float | `0.0` | sequence-similarity weight |
| `radius` | float | `12.0` | environment radius |
| `scale` | float | `17.0` | scoring scale |
| `base` | float | `0.65` | scoring base |
| `coord` | float | `0.0` | current-coordinate weight |
| `expect` | float | `6.0` | expected-score parameter |
| `window` | int | `3` | scoring window |
| `ante` | float | `-1.0` | ante-factor |

### Behaviour

The `seq`/`radius`/`scale`/`base`/`coord`/`expect`/`window`/`ante` knobs tune how much sequence vs. main-chain
path vs. secondary/tertiary structure vs. current coordinates contribute to the initial pairing — the reason
`super` beats `align` on weak-homology cases. Otherwise it behaves like `align` (same return list, same
`object`/`matrix`/`cutoff`/`cycles` semantics; internally both call the same `_cmd.align`).

### Examples

```
super protA////CA, protB////CA, object=supeAB
```

### Related

[align](fitting-alignment.md#align), [cealign](fitting-alignment.md#cealign), [usalign](fitting-alignment.md#usalign)

### Source

`packages/engine/modules/pymol/fitting.py:308`; `docs/api-reference/commands.mdx:3935`. Parity:
`packages/engine-ts/src/cmd/align.ts:539` — the TS port pairs guide Cα by structural order (ignoring resn),
Kabsch-fits, and ignores the fine-grained scoring weights and refinement cycles.

---

## cealign

`cealign` aligns two proteins using the **CE (Combinatorial Extension)** algorithm — a pure-structure aligner
that needs no sequence similarity. Note the argument order: **target first, mobile second**.

| Param | Type | Default | Meaning |
| --- | --- | --- | --- |
| `target` | string | | target selection (fixed) |
| `mobile` | string | | mobile selection (moved) |
| `target_state` | int | `1` | target object state |
| `mobile_state` | int | `1` | mobile object state |
| `quiet` | int | `1` | `-1` also prints the rotation matrix |
| `guide` | int | `1` | align on Cα only (`0` = all atoms) |
| `d0` | float | `3.0` | CE d0 distance parameter |
| `d1` | float | `4.0` | CE d1 distance parameter |
| `window` | int | `8` | CE fragment window size (must be > 2) |
| `gap_max` | int | `30` | max gap (must be >= 0) |
| `transform` | int | `1` | apply the superposition |
| `object` | string | `None` | alignment object to create |

### Behaviour

With `guide=1` (default) only alpha carbons are used; `guide=0` uses all atoms. Selections shorter than
`2*window` raise an error. Returns a dict `{alignment_length, RMSD, rotation_matrix}`. If `object` is given,
the selection may not span multiple objects. Reference: Shindyalov & Bourne (1998), *Protein Engineering*
11(9) 739-747.

### Examples

```
fetch 1rlw 1rsy, async=0
cealign 1rlw, 1rsy
```

### Related

[super](fitting-alignment.md#super), [align](fitting-alignment.md#align), [usalign](fitting-alignment.md#usalign)

### Source

`packages/engine/modules/pymol/fitting.py:27`; `docs/api-reference/commands.mdx:308`. Parity:
`packages/engine-ts/src/cmd/align.ts:556` — implemented as a Kabsch fit of order-paired guide Cα rather than
the true CE optimal-path search; `d0`/`d1`/`window`/`gap_max` are accepted but not used in the port.

---

## usalign

`usalign` (a.k.a. **TM-align / USalign**) performs a TM-score-optimised superposition. Unlike `align`/`super`,
TM-score is length-independent, so it suits proteins of different lengths or low sequence identity. Only guide
atoms — Cα of proteins, C4' of nucleic acids — are considered, regardless of the selection.

| Param | Type | Default | Meaning |
| --- | --- | --- | --- |
| `mobile` | str | | mobile selection |
| `target` | str | | target selection |
| `mobile_state` | int | `1` | mobile object state |
| `target_state` | int | `1` | target object state |
| `quiet` | int | `1` | suppress output |
| `transform` | int | `1` | apply the superposition transform |
| `object` | str \| None | `None` | alignment object to create |
| `fast` | int | `0` | fast mode, fewer iterations |

### Behaviour

TM-score ranges 0–1; above ~0.5 generally means the same fold. Based on Zhang & Skolnick's algorithm.
There is no separate `tmalign` command — `usalign` is the entry point for TM-align-style superposition.

### Examples

```
fetch 1rlw 1rsy, async=0
usalign 1rsy, 1rlw
usalign protA, protB, object=aln
```

### Related

[super](fitting-alignment.md#super), [cealign](fitting-alignment.md#cealign), [align](fitting-alignment.md#align)

### Source

`packages/engine/modules/pymol/fitting.py:137`; `docs/api-reference/commands.mdx:4226`. Parity:
`packages/engine-ts/src/cmd/align.ts:580` — the TS port Kabsch-fits order-paired guide Cα and computes a
TM-score approximation (`d0 = max(0.5, 1.24·∛(L-15) - 1.8)`), returning
`{tm_score_target, tm_score_mobile, RMSD, alignment_length, seq_identity}`.

---

## fit

`fit` superimposes the model in the first selection onto the second, using **only matching atoms** in both,
and moves the mobile model. Returns the post-fit RMS.

| Param | Type | Default | Meaning |
| --- | --- | --- | --- |
| `mobile` | string | | mobile selection (moved) |
| `target` | string | | target selection (fixed) |
| `mobile_state` | int | `0` | mobile object state (`0` = all states) |
| `target_state` | int | `0` | target object state (`0` = all states) |
| `quiet` | int | `1` | suppress output |
| `matchmaker` | int | `0` | how to pair atoms (see below) |
| `cutoff` | float | `2.0` | outlier-rejection cutoff (only if `cycles > 0`) |
| `cycles` | int | `0` | outlier-rejection refinement cycles |
| `object` | string | `None` | alignment object to create |

### Behaviour

`matchmaker` controls pairing: `-1` = atoms already in identical order; `0`/`1` = match on all identifiers
(segi, chain, resn, resi, name, alt); `2` = match on ID; `3` = match on rank; `4` = match on index. With the
default `matchmaker=0`, only atoms present in *both* selections (`(a) in (b)` / `(b) in (a)`) are used, so this
command is really only useful for very similar structures. Coordinates are transformed after the fit.

### Examples

```
fit protA, protB
fit (mutant and name CA), (wildtype and name CA)
```

### Related

[rms](fitting-alignment.md#rms), [rms_cur](fitting-alignment.md#rms_cur), [pair_fit](fitting-alignment.md#pair_fit), [align](fitting-alignment.md#align)

### Source

`packages/engine/modules/pymol/fitting.py:609`; `docs/api-reference/commands.mdx:931`. Parity:
`packages/engine-ts/src/cmd/align.ts:487` — Kabsch fit over identity-matched pairs; `cutoff`/`cycles`
refinement is not implemented.

---

## rms

`rms` computes an RMS **fit** between two selections but does **not** transform the models afterward — it tells
you the best-fit RMS you *would* get without moving anything.

| Param | Type | Default | Meaning |
| --- | --- | --- | --- |
| `mobile` | string | | mobile selection |
| `target` | string | | target selection |
| `mobile_state` | int | `0` | mobile state (`0` = all) |
| `target_state` | int | `0` | target state (`0` = all) |
| `quiet` | int | `1` | suppress output |
| `matchmaker` | int | `0` | atom-pairing mode (as in `fit`) |
| `cutoff` | float | `2.0` | outlier cutoff (only if `cycles > 0`) |
| `cycles` | int | `0` | refinement cycles |
| `object` | string | `None` | alignment object to create |

### Behaviour

Identical pairing/matchmaker semantics to `fit`; the only difference is it leaves coordinates untouched
(internally `_cmd.fit(..., mode=1)`).

### Examples

```
rms (mutant and name CA), (wildtype and name CA)
```

### Related

[fit](fitting-alignment.md#fit), [rms_cur](fitting-alignment.md#rms_cur), [intra_rms](fitting-alignment.md#intra_rms)

### Source

`packages/engine/modules/pymol/fitting.py:686`; `docs/api-reference/commands.mdx:3281`. Parity:
`packages/engine-ts/src/cmd/align.ts:478` — Kabsch-superposes identity-matched pairs and returns the residual
without moving the object.

---

## rms_cur

`rms_cur` computes the RMS difference between two selections **without any fitting** — a straight
coordinate-by-coordinate comparison of the paired atoms as they currently sit.

| Param | Type | Default | Meaning |
| --- | --- | --- | --- |
| `mobile` | string | | first selection |
| `target` | string | | second selection |
| `mobile_state` | int | `0` | mobile state (`0` = all) |
| `target_state` | int | `0` | target state (`0` = all) |
| `quiet` | int | `1` | suppress output |
| `matchmaker` | int | `0` | atom-pairing mode (as in `fit`) |
| `cutoff` | float | `2.0` | outlier cutoff (only if `cycles > 0`) |
| `cycles` | int | `0` | refinement cycles |
| `object` | string | `None` | alignment object to create |

### Behaviour

Use it when the two objects are already in a common frame (e.g. after `fit`/`align`) and you want the raw
deviation. Internally `_cmd.fit(..., mode=0)`.

### Examples

```
align a, b
rms_cur a, b        # residual after the align
```

### Related

[rms](fitting-alignment.md#rms), [fit](fitting-alignment.md#fit), [intra_rms_cur](fitting-alignment.md#intra_rms_cur)

### Source

`packages/engine/modules/pymol/fitting.py:732`; `docs/api-reference/commands.mdx:3299`. Parity:
`packages/engine-ts/src/cmd/align.ts:471` — RMS over identity-matched pairs, no superposition.

---

## intra_fit

`intra_fit` fits **all states of one object** onto an atom selection in a reference state (typical use:
aligning the frames of an NMR ensemble or trajectory). Returns the per-state RMS array.

| Param | Type | Default | Meaning |
| --- | --- | --- | --- |
| `selection` | string | | atoms to fit |
| `state` | int | `1` | reference (target) state |
| `quiet` | int | `1` | suppress output |
| `mix` | int | `0` | fit against a mixed/accumulated target |
| `pbc` | 0/1 | `1` | consider periodic boundary conditions |

### Behaviour

The reference state's own entry comes back as a negative sentinel (the port uses `-1.0`). Coordinates of the
fitted states are moved. `intra_fit` operates within a single object.

### Examples

```
intra_fit (name CA)
intra_fit polymer, state=1
```

### Related

[intra_rms](fitting-alignment.md#intra_rms), [intra_rms_cur](fitting-alignment.md#intra_rms_cur), [fit](fitting-alignment.md#fit)

### Source

`packages/engine/modules/pymol/fitting.py:462`; `docs/api-reference/commands.mdx:1861`. Parity:
`packages/engine-ts/src/cmd/align.ts:704` — Kabsch-fits every state onto the reference state; `mix` and `pbc`
are not honoured.

---

## intra_rms

`intra_rms` calculates RMS **fit** values for all states of an object relative to a reference state, but
**leaves coordinates unchanged**. Returns the RMS array.

| Param | Type | Default | Meaning |
| --- | --- | --- | --- |
| `selection` | string | | atoms to compare |
| `state` | int | `0` | reference state |
| `quiet` | int | `1` | suppress output |

### Behaviour

Like `intra_fit` but non-destructive — it reports the best-fit RMS each state would reach without moving them.
The reference state's entry is a negative sentinel.

### Examples

```
rms = cmd.intra_rms("(name CA)", 1)
```

### Related

[intra_fit](fitting-alignment.md#intra_fit), [intra_rms_cur](fitting-alignment.md#intra_rms_cur), [rms](fitting-alignment.md#rms)

### Source

`packages/engine/modules/pymol/fitting.py:522`; `docs/api-reference/commands.mdx:1875`. Parity:
`packages/engine-ts/src/cmd/align.ts:679` — Kabsch residual per state, coordinates untouched.

---

## intra_rms_cur

`intra_rms_cur` calculates RMS values for all states of an object relative to a reference state **without any
fitting** — the raw per-state deviation of the current coordinates. Returns the RMS array.

| Param | Type | Default | Meaning |
| --- | --- | --- | --- |
| `selection` | string | | atoms to compare |
| `state` | int | `0` | reference state |
| `quiet` | int | `1` | suppress output |

### Behaviour

The state analogue of `rms_cur`: use it to measure how far each frame drifts from a reference without any
alignment. Internally `_cmd.intrafit(..., mode=0)`.

### Examples

```
rms = cmd.intra_rms_cur("(name CA)", 1)
```

### Related

[intra_rms](fitting-alignment.md#intra_rms), [rms_cur](fitting-alignment.md#rms_cur), [intra_fit](fitting-alignment.md#intra_fit)

### Source

`packages/engine/modules/pymol/fitting.py:566`; `docs/api-reference/commands.mdx:1887`. Parity: not ported to
`packages/engine-ts` (only `intra_fit` and `intra_rms` are registered).

---

## pair_fit

`pair_fit` fits **explicitly matched sets of atom pairs** between two objects — you list mobile/target
selections two-by-two, and they pair atom-by-atom in order. The mobile object is moved. Returns the post-fit
RMS.

| Param | Type | Default | Meaning |
| --- | --- | --- | --- |
| `*arg` | strings | | alternating mobile/target selections (even count, >= 2) |
| `quiet` | int | `0` | suppress output |

### Behaviour

Requires an even number of selections (>= 2). If atoms are stored in the same internal order you can pass just
two selections; otherwise specify each atom pair separately. Because pairing is positional, order matters —
`pair_fit ligA////C1, ligB////C8, ...` maps C1→C8. Script files are recommended for non-trivial pairings; this
command backs the Pair Fitting wizard.

### Examples

```
pair_fit protA/10-25+33-46/CA, protB/22-37+41-54/CA
pair_fit ligA////C1, ligB////C8, ligA////C2, ligB////C4
```

### Related

[fit](fitting-alignment.md#fit), [rms](fitting-alignment.md#rms), [align](fitting-alignment.md#align)

### Source

`packages/engine/modules/pymol/fitting.py:776`; `docs/api-reference/commands.mdx:2822`. Parity:
`packages/engine-ts/src/cmd/align.ts:612` — pairs each mobile/target selection atom-by-atom in order,
Kabsch-fits the union, and carries the mobile object(s) (single state).

---

## extra_fit

`extra_fit` is like `intra_fit` but across **multiple objects** instead of multiple states: it fits every
object in a selection onto a reference object using a chosen alignment method.

| Param | Type | Default | Meaning |
| --- | --- | --- | --- |
| `selection` | string | `'(all)'` | selection spanning multiple objects |
| `reference` | string | `''` | reference object name (default: first object) |
| `method` | string | `'align'` | fitting command taking `mobile`/`target` (`align`, `super`, `cealign`, ...) |
| `zoom` | int | `1` | zoom to the selection when done |
| `quiet` | int | `0` | suppress per-object RMSD lines |
| `**kwargs` | | | extra args forwarded to `method` |

### Behaviour

`method` may be any command (or callable in `cmd.keyword`) that accepts `mobile` and `target`. Extra keyword
args pass through, so e.g. `extra_fit ..., method=align, object=aln` creates an alignment object. Prints one
`RMSD` line per fitted object unless `quiet`.

### Examples

```
extra_fit name CA, 1cll, super
extra_fit (all), reference=refobj, method=cealign
```

### Related

[alignto](fitting-alignment.md#alignto), [intra_fit](fitting-alignment.md#intra_fit), [align](fitting-alignment.md#align)

### Source

`packages/engine/modules/pymol/fitting.py:203`; `docs/api-reference/commands.mdx:814`. Parity:
`packages/engine-ts/src/cmd/align.ts:660` — superposes every non-reference object present in `selection` onto
`reference` via a structural Cα fit; the `method`/`zoom`/`kwargs` plumbing is simplified.

---

## alignto

`alignto` aligns **all other loaded objects** onto a target object using a chosen algorithm. It is a thin
wrapper over `extra_fit`.

| Param | Type | Default | Meaning |
| --- | --- | --- | --- |
| `target` | str | `''` | reference object (default: first object in selection) |
| `method` | str | `'cealign'` | fitting method (see `extra_fit`) |
| `selection` | str | `''` | selection to operate on (default: public objects) |
| `quiet` | int | `1` | suppress output |
| `**kwargs` | | | forwarded to `extra_fit`/`method` |

### Behaviour

When `selection` is empty it targets all public objects. Note the default method is `cealign` (structure-based),
unlike `extra_fit`'s `align`. Pass `object=` to build a combined alignment object across everything.

### Examples

```
fetch 1cll 1sra 1ggz 1k95, async=0
alignto 1cll, method=cealign
alignto 1cll, object=all_to_1cll
```

### Related

[extra_fit](fitting-alignment.md#extra_fit), [cealign](fitting-alignment.md#cealign), [super](fitting-alignment.md#super)

### Source

`packages/engine/modules/pymol/fitting.py:265`; `docs/api-reference/commands.mdx:69`. Parity:
`packages/engine-ts/src/cmd/align.ts:647` — superposes every other loaded object onto the target by structural
Cα fit and returns a list of `[name, rms, ...]` rows.

---

## get_raw_alignment

`get_raw_alignment` returns the per-atom alignment relationships of an alignment object as a list of columns,
each a list of `(object, index)` tuples.

| Param | Type | Default | Meaning |
| --- | --- | --- | --- |
| `name` | str | `''` | alignment object name |
| `active_only` | int | `0` | restrict to currently enabled members |

### Behaviour

The inverse of `set_raw_alignment`. Each inner list is one alignment *column* (a set of paired atoms across
objects). Used to inspect or export the pairing an `align`/`super`/`cealign` produced with `object=`.

### Examples

```
align a, b, object=aln
raw = cmd.get_raw_alignment("aln")
```

### Related

[set_raw_alignment](fitting-alignment.md#set_raw_alignment), [align](fitting-alignment.md#align)

### Source

`packages/engine/modules/pymol/querying.py:1487`; `docs/api-reference/commands.mdx:1481`. Parity:
`packages/engine-ts/src/cmd/align.ts:735` — registered as a `[]` stub; alignment objects are not yet
materialised in the TS port.

---

## set_raw_alignment

`set_raw_alignment` is an API-only command that **creates an alignment object** from explicit lists of atom
indices — the inverse of `get_raw_alignment`.

| Param | Type | Default | Meaning |
| --- | --- | --- | --- |
| `name` | str | | alignment object name to create |
| `raw` | list | | list of columns, each a list of `(model, index)` tuples |
| `guide` | str | `''` | name of the guide object |
| `state` | int | `1` | object state |
| `quiet` | int | `1` | suppress output |

### Behaviour

Lets scripts construct alignment objects programmatically (e.g. from an external aligner) without running
`align`/`super`. Each element of `raw` is an alignment column of `(model, index)` pairs.

### Examples

```
cmd.set_raw_alignment("aln", [[("a", 1), ("b", 5)], [("a", 2), ("b", 6)]])
```

### Related

[get_raw_alignment](fitting-alignment.md#get_raw_alignment), [align](fitting-alignment.md#align)

### Source

`packages/engine/modules/pymol/creating.py:648`; `docs/api-reference/commands.mdx:3672`. Parity: not ported to
`packages/engine-ts`.

---

## morph

`morph` creates an **interpolated trajectory** between two (or more) conformations. If the two inputs differ,
they are matched by sequence alignment first. Two methods exist: `rigimol` (incentive-only) and `linear`
(quick, robust, but may distort intermediates).

| Param | Type | Default | Meaning |
| --- | --- | --- | --- |
| `name` | string | | name of the multi-state object to create |
| `sele1` | string | | first conformation |
| `sele2` | string | `None` | second conformation (default: `<sele1>`) |
| `state1` | int | `-1` | sele1 state (default 1; `0` = all states → N morphings) |
| `state2` | int | `-1` | sele2 state (default 2 if sele1=sele2, else 1) |
| `refinement` | int | `3` | sculpting refinement cycles to clean intermediates |
| `steps` | int | `30` | number of interpolated states |
| `method` | string | `'rigimol'` | `rigimol` or `linear` |
| `match` | | `'align'` | how to match atoms between conformations |
| `quiet` | int | `1` | suppress output |

### Behaviour

`morph` is **incentive-only** in Open-Source PyMOL: the raise sits at the top of `morphing.py`
before the method dispatch, so BOTH `method=rigimol` and `method=linear` raise
`IncentiveOnlyException`. The TS engine matches upstream by raising the identical error for every
`morph` call (verified against the real-PyMOL oracle).

### Examples

```
fetch 1akeA 4akeA, async=0
align 1akeA, 4akeA
morph mout, 1akeA, 4akeA          # incentive-only: raises IncentiveOnlyException
```

### Related

[align](fitting-alignment.md#align), [intra_fit](fitting-alignment.md#intra_fit)

### Source

`packages/engine/modules/pymol/morphing.py:42` (raises `IncentiveOnlyException` unconditionally).
Parity: `packages/engine-ts/src/cmd/movie2.ts` (`ctx.command('morph', …)`) raises the same
incentive-only error to match Open-Source PyMOL.
