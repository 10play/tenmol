---
name: coloring-system
kind: feature
category: coloring
summary: The PyMOL coloring commands and mechanisms — color/color_deep/set_color/spectrum/recolor/desaturate, the colorection scene-snapshot API, ramp objects as colors, the element/chain/secondary-structure/rep colour schemes, the auto-colour cycle, the color-index integer space, and the built-in spectrum palettes (this doc covers the machinery, not the enumeration of named colours).
---

## Purpose

Colour in PyMOL is an **integer property** on every atom (`AtomInfo::color`) plus a set of
**per-representation colour settings** on objects (e.g. `cartoon_color`, `surface_color`). This
reference covers the commands and mechanisms that *assign* those integers — not the catalogue of
named colours (that is a separate document). Every colour reference — a name, a number, a `0x`
hex literal, one of the special words `default/atomic/object/front/back/auto/current`, or a ramp
object — resolves to an entry in a single flat colour table (`ColorGetIndex`,
`packages/engine/layer1/Color.cpp:661`). Commands here fall into three groups: **assigners**
(`color`, `color_deep`, `spectrum`, `desaturate`, the `util.cb*` scheme helpers), **definers**
(`set_color`, `ramp_new`), and **plumbing** (`recolor`, the `get/set/del_colorection` scene
snapshots). Colour indices are frozen and load-bearing: menus hardcode them and `.pse` sessions
serialize them, so `set_color` *extends* the table rather than mutating existing slots.

## Syntax

Assigner commands share a `color, selection` (or `expression, palette, selection`) shape and a
trailing `quiet`. `set_color`/`ramp_new` are definers keyed by a `name`. See each feature's
`## Syntax` for the exact introspected signature and defaults. Colour arguments accept: a bare
name (`cyan`), a numeric index (`5`), a `0xRRGGBB` inline RGB literal, a special word
(`atomic`, `object`, `front`, `back`, `default`, `auto`, `current`), or the name of a live
`ramp_new` object.

## Behaviour

- **Colour is an int, resolved late.** `cmd.color` stores an index on each atom;
  `ColorGetRGB`/`ColorGetRamped` turn it into RGB only at draw time. Ramp indices (`<= -10`) and
  the specials (`atomic` = per-element, `object` = object colour, `front`/`back` =
  background-contrast) are evaluated *per vertex* — so ramp-coloured geometry must be baked
  server-side before it reaches three.js.
- **`flags` on `cmd.color`.** `flags=0` sets the per-atom colour; `flags=1` sets the **object**
  colour instead (used by `util.cba`/`cbh` to colour reps that follow object colour).
- **`color_deep` = unset + colour.** It `unset_deep`s every per-object/per-atom colour *setting*
  (all of `menu.rep_setting_lists` — `line_color`, `stick_color`, `cartoon_color`, …) so that no
  rep override survives, then applies the colour. This is what the internal-GUI colour swatches
  invoke (`all_colors` → `cmd.color_deep`).
- **`recolor` is a refresh, not an assignment.** It forces reapplication of existing colours to
  built geometry and is required after `set_color` redefines a colour that is already in use.
- **`spectrum` auto-ranges.** With `minimum`/`maximum` unset it scans the selection's values;
  non-numeric expressions (e.g. `resn`, `chain`) are *enumerated* in first-seen order. When the
  expression is not purely alphabetic or the palette is not a known palette name, `spectrum`
  **delegates to `spectrumany`**, the pure-Python path that accepts arbitrary colour lists and
  writes packed `0x40RRGGBB` inline colours.
- **Colorections are scene colour snapshots.** `get_colorection(key)` captures the current colour
  of everything under a key; `set_colorection(dict, key)` restores it; `del_colorection` drops it.
  Scenes use these to store/restore colour state.
- **`set_color` extends the table.** A new name appends a slot at the next free index; an existing
  name overwrites that slot's RGB in place (so its index stays valid in old sessions). RGB is
  auto-scaled: if any component `> 1.0`, the triple is treated as 0–255 and divided by 255.

## Examples

```
# direct and by-selection colouring
color cyan
color yellow, chain A

# element (CPK) colouring keeping a coloured carbon
util.cbag           # carbons green, heteroatoms by element
color atomic, not elem C

# spectra
spectrum b, blue_red, minimum=10, maximum=50
spectrum count, rainbow_rev, chain A, byres=1
spectrum resi, green_yellow_red        # non-alphabetic expr -> spectrumany path

# define + reapply a custom colour
set_color myblue, [0.2, 0.4, 0.9]
color myblue, resn LIG
recolor

# ramp as a colour
ramp_new e_lvl, e_pot_map, [-10, 0, 10], [red, white, blue]
color e_lvl, polymer

# by chain / by secondary structure
util.cbc                                # rainbow-cycle per chain
util.cbss polymer, red, yellow, green   # helix / sheet / loop
```

---

## color

### Purpose
Changes the colour of objects or atoms — the primary colour assigner. Accepts any colour
reference (name, number, hex, special word, or ramp name).

### Syntax
| Parameter | Type | Default | Description |
| --- | --- | --- | --- |
| `color` | string | | colour name or number |
| `selection` | string | `'(all)'` | selection-expression or name-pattern |
| `quiet` | | `1` | |
| `flags` | | `0` | `1` sets the **object** colour instead of per-atom |

British spelling `colour` is a registered alias. Returns the number of atoms recoloured.

### Behaviour
Preprocesses the selection, resolves the colour through `_interpret_color`, then calls
`_cmd.color`. Ramp objects may be used as a colour (per-vertex evaluation). `flags=1` writes the
object colour, used by `util.cba`/`cbh`.

### Examples
```
color cyan
color yellow, chain A
color e_lvl, polymer     # e_lvl is a ramp object
```

### Related
`color_deep`, `set_color`, `recolor`, `spectrum`, element/chain colour schemes

### Source
`packages/engine/modules/pymol/viewing.py:1904`; TS engine `packages/engine-ts/src/exec/executive.ts:216`

---

## color_deep

### Purpose
Unset all object- and atom-level (not global) colour *settings* and then apply the given colour —
a "hard reset" colour that clears every per-rep override so the colour is uniform.

### Syntax
| Parameter | Type | Default | Description |
| --- | --- | --- | --- |
| `color` | str | | colour name or number |
| `name` | str | `'all'` | object name or pattern |
| `quiet` | | `1` | |

### Behaviour
Runs `unset_deep` over every colour setting in `menu.rep_setting_lists`
(`line_color, stick_color, ribbon_color, cartoon_color, label_color, dot_color, sphere_color,
mesh_color, surface_color`, plus the measurement/extra colour settings), then calls `color`. This
is the command bound to the internal-GUI colour swatches (`menu.all_colors`).

### Examples
```
color_deep white              # clear all rep colour overrides, everything white
color_deep salmon, myprotein
```

### Related
`color`, `unset_deep`, by-rep colour scheme

### Source
`packages/engine/modules/pymol/viewing.py:1948`; TS `packages/engine-ts/src/cmd/display.ts:132`

---

## set_color

### Purpose
Defines a new colour (or redefines an existing one) from RGB components, extending the colour-index
table.

### Syntax
| Parameter | Type | Default | Description |
| --- | --- | --- | --- |
| `name` | string | | name for the new or existing colour |
| `rgb` | list | | `[r, g, b]`, all in `(0.0, 1.0)` **or** `(0, 255)` |
| `mode` | | `0` | |
| `quiet` | | `1` | |

### Behaviour
A string `rgb` is `safe_list_eval`'d; the list must have length 3. PyMOL **infers the range**: if
any component `> 1.0`, the triple is divided by 255. A brand-new name appends a slot at the next
free index; an existing name overwrites its slot's RGB in place (index preserved, so old sessions
stay valid). Calls `_cmd.colordef` then `_invalidate_color_sc` (clears the name-completion cache).
Existing geometry is **not** recoloured automatically — issue `recolor` afterwards.

### Examples
```
set_color red, [1.0, 0.0, 0.0]
set_color yellow, [255, 255, 0]
set_color myblue, [0.2, 0.4, 0.9]
recolor
```

### Related
`recolor`, `color`, color-index integer space

### Source
`packages/engine/modules/pymol/viewing.py:2153`; TS `packages/engine-ts/src/cmd/coloring.ts:285`, `packages/engine-ts/src/exec/color.ts:79`

---

## spectrum

### Purpose
Colours atoms with a spectrum (gradient) based on a per-atom property, mapped across a named
palette.

### Syntax
| Parameter | Type | Default | Description |
| --- | --- | --- | --- |
| `expression` | | `'count'` | atomic property to map (see vocabulary below) |
| `palette` | string | `'rainbow'` | palette name **or** space-separated colour list |
| `selection` | string | `'(all)'` | atoms to colour |
| `minimum` | float | `None` | `None` = automatic |
| `maximum` | float | `None` | `None` = automatic |
| `byres` | integer | `0` | apply per-residue |
| `quiet` | | `1` | |
| `interpolation` | | `'rgb'` | `rgb`, `hls`, or `hsv` (used on the `spectrumany` path) |

**Expression vocabulary.** `count` (atom order), `b` (temperature/B-factor), `q` (occupancy),
`pc`/`partial_charge`, `fc`/`formal_charge`, `resi` (aliased to `resv`, the residue identifier),
plus any other numeric field that works in `iterate`. Non-numeric expressions (e.g. `resn`,
`chain`, `ss`, `segi`, `elem`, `name`) are **enumerated** in first-seen order. Aliases resolved on
the `spectrumany` path: `pc→partial_charge`, `fc→formal_charge`, `resi→resv`.

**Built-in palettes accepted** (resolved through `palette_sc`, backed by
`constants_palette.py`): `rainbow`, `rainbow_rev`, `rainbow2`, `rainbow2_rev`, `rainbow_cycle`,
`rainbow_cycle_rev`, `gcbmry`, `yrmbcg`, `cbmr`, `rmbc`, `green_yellow_red`, `red_yellow_green`,
and the full white-separated family `blue_white_red`, `red_white_blue`, `yellow_white_blue`,
`blue_white_yellow`, `red_white_green`, `green_white_red`, `green_white_magenta`,
`magenta_white_green`, `magenta_white_cyan`, `cyan_white_magenta`, `cyan_white_yellow`,
`yellow_cyan_white`, `yellow_white_green`, `green_white_yellow`, `green_white_blue`,
`blue_white_green`, `blue_white_magenta`, `magenta_white_blue`, `magenta_white_yellow`,
`yellow_white_magenta`, `yellow_white_red`, `red_white_yellow`, `red_white_cyan`, `cyan_white_red`,
plus the two-colour complementary family `blue_green`, `green_red`, `red_green`, `green_blue`,
`blue_red`, `red_blue`, `yellow_blue`, `blue_yellow`, `green_magenta`, `magenta_green`,
`magenta_cyan`, `cyan_magenta`, `cyan_yellow`, `yellow_cyan`, `yellow_green`, `green_yellow`,
`blue_magenta`, `magenta_blue`, `magenta_yellow`, `yellow_magenta`, `yellow_red`, `red_yellow`,
`red_cyan`, `cyan_red`. See the **built-in palettes** feature for the full 57-entry table.

### Behaviour
Resolves the palette through `palette_sc`. **Falls back to `spectrumany`** when the expression is
not purely alphabetic or the palette is not a known palette name (`viewing.py:2133`). Otherwise
each palette entry is `(prefix, digits, first, last)` — `prefix ∈ o|s|r|c|w` selects one of the
generated 1000-colour bands and `first`/`last` index within it — and it calls the C `_cmd.spectrum`
over that band. `minimum=None`/`maximum=None` signals auto-ranging (internally `minimum=0,
maximum=-1`). Returns `(min, max)`.

### Examples
```
spectrum b, blue_red, minimum=10, maximum=50
spectrum count, rainbow_rev, chain A, byres=1
spectrum resi, green_yellow_red        # non-alpha expr -> spectrumany
spectrum pc, blue_white_red            # by partial charge
```

### Related
`spectrumany`, `ramp_new`, built-in palettes, `util.chainbow`

### Source
`packages/engine/modules/pymol/viewing.py:2065`; palettes `packages/engine/modules/pymol/constants_palette.py:1`; TS `packages/engine-ts/src/cmd/coloring.ts:295`

---

## spectrumany

### Purpose
Pure-Python spectrum that accepts an **arbitrary colour list** (not just named palettes) and any
numeric `iterate` expression. Not a standalone command in menus — it is the fallback engine of
`spectrum`.

### Syntax
| Parameter | Type | Default | Description |
| --- | --- | --- | --- |
| `expression` | | | atomic property (as `spectrum`) |
| `colors` | | | space-separated colour names, or a palette-name string |
| `selection` | string | `'(all)'` | atoms to colour |
| `minimum` | float | `None` | auto if `None` |
| `maximum` | float | `None` | auto if `None` |
| `quiet` | | `1` | |
| `interpolation` | | `'rgb'` | `rgb`, `hls`, or `hsv` |

### Behaviour
Requires ≥ 2 colours. Interpolates in RGB/HLS/HSV (`_spectrumany_interpolations`). Aliases
`pc→partial_charge, fc→formal_charge, resi→resv`; non-numeric values are enumerated. Writes packed
`0x40RRGGBB` inline TRGB colours via `alter(... 'color = next_color() or color')` then `recolor`.
`palette_colors_dict` maps the 10 rainbow-family palette names to explicit colour-name strings for
this path.

### Examples
```
# arbitrary 3-colour ramp over B-factor
spectrum b, "blue white orange", polymer
```

### Related
`spectrum`, `set_color`, TRGB inline colours

### Source
`packages/engine/modules/pymol/viewing.py:1978`

---

## recolor / recolour

### Purpose
Forces reapplication of colours to already-built geometry. Needed after `set_color` redefines a
colour that existing objects use.

### Syntax
| Parameter | Type | Default | Description |
| --- | --- | --- | --- |
| `selection` | | `'all'` | |
| `representation` | | `'everything'` | representation to recolour |

British spelling `recolour` is a registered alias.

### Behaviour
Resolves the representation via `repres_sc` and calls `_cmd.recolor`. Does not change any colour
assignment — only invalidates and re-applies cached colours/geometry.

### Examples
```
set_color myblue, [0.1, 0.2, 0.9]
recolor
recolor cartoon, polymer
```

### Related
`color`, `set_color`

### Source
`packages/engine/modules/pymol/viewing.py:1868`; TS `packages/engine-ts/src/cmd/display.ts:154` (alias `packages/engine-ts/src/cmd/topics.ts:145`)

---

## desaturate

### Purpose
Desaturates (greys down) the colours in a selection by blending each atom's colour toward grey.

### Syntax
| Parameter | Type | Default | Description |
| --- | --- | --- | --- |
| `selection` | str | `'all'` | atom selection |
| `a` | | `0.5` | blend amount toward grey (0 = unchanged, 1 = fully grey) |
| `quiet` | | `1` | |

### Behaviour
For each distinct source colour, blends `rgb*(1-a) + grey*a` and registers the result as a new
colour via `set_color`, remapping atoms to it (identical source colours share one new slot).

### Examples
```
desaturate                 # 50% toward grey, all atoms
desaturate chain B, 0.8
```

### Related
`set_color`, `color`

### Source
`docs/api-reference/commands.mdx` `### cmd.desaturate`; TS `packages/engine-ts/src/cmd/display.ts:184`

---

## get_colorection

### Purpose
Snapshot the current colour of everything under a key — a scene colour capture used by the
scene system to store colour state.

### Syntax
| Parameter | Type | Default | Description |
| --- | --- | --- | --- |
| `key` | | | name/key under which to store the snapshot |

### Behaviour
Returns (and caches) the colour snapshot; the reciprocal of `set_colorection`.

### Examples
```
sceneColors = cmd.get_colorection("myscene")
```

### Related
`set_colorection`, `del_colorection`, scenes

### Source
`packages/engine/modules/pymol/viewing.py:907`; TS `packages/engine-ts/src/cmd/misc2.ts:74`

---

## set_colorection

### Purpose
Restore atom/object colours from a colorection snapshot (a dict/array) previously captured by
`get_colorection`.

### Syntax
| Parameter | Type | Default | Description |
| --- | --- | --- | --- |
| `dict` | | | the snapshot to restore |
| `key` | | | key identifying the snapshot |

### Behaviour
Applies the stored colours back onto the matching atoms/objects (matched by identity).

### Examples
```
cmd.set_colorection(sceneColors, "myscene")
```

### Related
`get_colorection`, `del_colorection`, scenes

### Source
`packages/engine/modules/pymol/viewing.py:911`; TS `packages/engine-ts/src/cmd/misc2.ts:85`

---

## del_colorection

### Purpose
Delete a stored colorection snapshot.

### Syntax
| Parameter | Type | Default | Description |
| --- | --- | --- | --- |
| `dict` | | | the snapshot |
| `key` | | | key to drop |

### Behaviour
Drops the cached snapshot under the key.

### Examples
```
cmd.del_colorection(sceneColors, "myscene")
```

### Related
`get_colorection`, `set_colorection`, scenes

### Source
`packages/engine/modules/pymol/viewing.py:915`; TS `packages/engine-ts/src/cmd/misc2.ts:102`

---

## ramp_new

### Purpose
Creates a colour ramp object that maps a map potential value (or proximity to a molecular object)
to a colour. A ramp is a first-class object usable **as a colour** — `color <ramp_name>, <sel>`
colours atoms by the map value at each atom's position.

### Syntax
| Parameter | Type | Default | Description |
| --- | --- | --- | --- |
| `name` | string | | name of the ramp object |
| `map_name` | string | | name of the map (potential) or molecular object |
| `range` | list | `[-1.0, 0.0, 1.0]` | values corresponding to ramp slots |
| `color` | list | `['red', [1.0, 1.0, 1.0], 'blue']` | colours for the ramp slots |
| `state` | integer | `1` | state identifier |
| `selection` | selection | `''` | for automatic ranging |
| `beyond` | number | `2.0` | auto-ranging: exclusion distance |
| `within` | number | `6.0` | auto-ranging: inclusion distance |
| `sigma` | number | `2.0` | auto-ranging: standard deviations |
| `zero` | integer | `1` | auto-ranging: force central slot to zero |
| `quiet` | | `1` | |

### Behaviour
Ramps are registered as colour "extensions" with index `-10 - slot`
(`ColorRegisterExt`), and evaluated **per vertex** at draw time. `color` may be a list of
names/tuples (each resolved with `get_color_tuple(a, 4)` so specials survive) or one of the named
spectra in `ramp_spectrum_dict` (`traditional, sludge, ocean, hot, grayable, rainbow, afmhot,
grayscale, object`). See the `maps-volumes` topic for the full ramp lifecycle.

### Examples
```
ramp_new e_lvl, e_pot_map, [-10, 0, 10], [red, white, blue]
color e_lvl, polymer
set surface_color, e_lvl, prot
```

### Related
`ramp_update`, `color`, `spectrum`, maps-volumes topic

### Source
`packages/engine/modules/pymol/creating.py:374`; ramp objects `packages/engine/layer1/Color.cpp:347`; TS `packages/engine-ts/src/cmd/ramps.ts:178`

---

## Element / CPK atomic colouring

### Purpose
Colour atoms by chemical element (the CPK convention), typically keeping carbons a chosen colour so
that different molecules are distinguishable while heteroatoms stay canonical (N blue, O red,
S yellow, …). This is the meaning of the special colour `atomic` and the `util.cb*` helper family.

### Behaviour
- `color atomic, <sel>` sets each atom to its per-element colour (colour index `-4`, resolved
  per-atom at draw time from the element colours in the colour table).
- `util.cnc(sel)` — "colour non-carbon": colour only heteroatoms by element, leave carbon.
- `util.color_carbon(color, sel)` / `util.cba(color, sel)` — colour carbons `color` and everything
  else by element; `cba` also sets the object colour (`flags=1`). `util.cbh` does the same but also
  colours hydrogens.
- Fixed-carbon shortcuts: `cbag` (green), `cbac` (cyan), `cbam` (lightmagenta), `cbay` (yellow),
  `cbas` (salmon), `cbaw` (white/hydrogen grey), `cbab` (slate), `cbao` (brightorange),
  `cbap` (purple), `cbak` (pink).
- `util.colors('jmol')` redefines the element colours to Jmol values.

### Examples
```
util.cbag              # carbons green
util.cnc heteroatoms   # only non-carbons by element
color atomic, not elem C
```

### Related
`color`, by-chain colouring, colour-index integer space

### Source
`packages/engine/modules/pymol/util.py:427` (`color_carbon`), `util.py:512` (`cnc`), `util.py:518` (`cba`), `util.py:526` (`cbh`), `util.py:442` (`cbag`); TS `packages/engine-ts/src/cmd/coloring.ts:409`, `packages/engine-ts/src/cmd/util2.ts:330`

---

## Colour by chain

### Purpose
Assign a distinct colour to each chain so subunits are visually separable — the standard way to
colour a multi-chain assembly.

### Behaviour
- `util.cbc(selection, first_color=7, quiet, legacy=0)` — iterates `cmd.get_chains` and colours
  each chain from `_color_cycle[c % 40]` (the 40-colour auto cycle) unless `legacy=1`, which uses
  `first_color + c`. Aliased `color_chains = cbc`.
- `util.color_objs(selection)` — one colour per object (rather than per chain).
- `util.chainbow(selection, palette='rainbow')` — per model, per chain, runs
  `spectrum('count', palette, …, byres=1)` so each chain is an N→C rainbow.

### Examples
```
util.cbc                       # rainbow-cycle colour per chain
util.cbc polymer, legacy=1     # legacy first_color+index scheme
util.chainbow                  # N-to-C rainbow within each chain
```

### Related
`spectrum`, auto-colour cycle, element colouring

### Source
`packages/engine/modules/pymol/util.py:771` (`cbc`), `util.py:787` (`color_objs`), `util.py:809` (`chainbow`); `_color_cycle` `util.py:27`; TS `packages/engine-ts/src/cmd/coloring.ts:429`, `packages/engine-ts/src/cmd/util2.ts:419`

---

## Colour by secondary structure

### Purpose
Colour atoms by their assigned secondary-structure type — helix / sheet / loop — a common
cartoon-view convention.

### Behaviour
`util.cbss(selection, helix_color='red', sheet_color='yellow', loop_color='green')` issues three
`cmd.color` calls on `ss H`, `ss S`, and `not ss S+H`. The internal-GUI `by_ss` menu exposes three
presets (red/yellow/green, cyan/magenta/salmon, cyan/red/magenta). Secondary structure can also be
driven through `spectrum ss, …`, which enumerates the `ss` values.

### Examples
```
util.cbss                              # red helix, yellow sheet, green loop
util.cbss polymer, cyan, magenta, salmon
```

### Related
`spectrum`, `color`, cartoon representation

### Source
`packages/engine/modules/pymol/util.py:432` (`cbss`); menu `packages/engine/modules/pymol/menu.py:420`; TS `packages/engine-ts/src/cmd/util2.ts:395`

---

## Colour by representation (by-rep)

### Purpose
Colour a *representation* independently of the underlying atom colour, by writing the per-rep
colour **settings** rather than atom colours — e.g. a grey surface over rainbow cartoon.

### Behaviour
The internal-GUI `by_rep` menu writes per-rep colour settings driven by `menu.rep_setting_lists`:
- molecule: `line_color, stick_color, ribbon_color, cartoon_color, label_color, dot_color,
  sphere_color, mesh_color, surface_color`
- measurement: `dash_color, angle_color, dihedral_color, label_color`
- extra: `cartoon_highlight_color, cartoon_ladder_color, cartoon_nucleic_acid_color,
  cartoon_ring_color, ellipsoid_color, label_outline_color, ray_interior_color, ray_trace_color,
  stick_ball_color`

Each submenu ends with an **unset** entry (`cmd.unset(setting, sele)`) that reverts the rep to
following the atom colour. `color_deep` is the inverse: it `unset_deep`s all of these at once. Set
a rep colour with `set <rep>_color, <color>, <selection>`.

### Examples
```
set cartoon_color, grey80, polymer
set surface_color, white
unset surface_color, polymer   # revert surface to atom colour
```

### Related
`color_deep`, `set` (settings), `recolor`

### Source
`packages/engine/modules/pymol/menu.py:428` (`by_rep`), `menu.py:482` (`rep_setting_lists`)

---

## spectrum vs spectrumany

### Purpose
Understand the two-tier spectrum implementation: the fast C-backed `spectrum` for named palettes on
alphabetic expressions, versus the pure-Python `spectrumany` fallback for arbitrary colour lists,
non-alphabetic expressions, and HLS/HSV interpolation.

### Behaviour
`spectrum` dispatches to `spectrumany` whenever `expression.replace('_','').isalpha()` is false or
the palette is not a known palette name (`viewing.py:2133`). Consequences:
- Named palette + simple expression (`spectrum b, rainbow`) → C fast path over a generated
  1000-colour band; colours are real named-colour indices.
- Arbitrary colour list (`spectrum b, "blue white red"`) or expression like `resi` → `spectrumany`,
  which packs `0x40RRGGBB` inline TRGB colours and honours `interpolation` (`rgb`/`hls`/`hsv`).
The TS engine implements the palette path (all 57 palettes) plus enumeration of non-numeric
expressions inline; it does not register a separate `spectrumany` command.

### Examples
```
spectrum b, rainbow              # C fast path
spectrum b, "blue white red"     # spectrumany path (custom colours)
spectrum resn                    # spectrumany path (enumerated expression)
```

### Related
`spectrum`, `spectrumany`, built-in palettes

### Source
`packages/engine/modules/pymol/viewing.py:2133` (dispatch), `viewing.py:1978` (`spectrumany`); TS `packages/engine-ts/src/cmd/coloring.ts:295`

---

## Auto-colour cycle (auto_color / auto_color_next)

### Purpose
The `auto`/`current` special colours and the 40-colour cycle used to give each new object (or each
chain in `util.cbc`) a fresh distinguishable colour automatically.

### Behaviour
- Special colour `auto` (`cColorNewAuto` = `-2`) resolves via `ColorGetNext`, which reads the global
  setting `auto_color_next`, returns `AutoColor[next]` (a 40-entry index table), and advances
  `auto_color_next` (wrapping at 40). `current` (`cColorCurAuto` = `-3`) returns the current cycle
  colour without advancing.
- The `auto_color` global setting (on by default) makes loading a new object pick the next auto
  colour; the internal-GUI `color_auto` menu runs `color auto` and `util.color_objs`.
- `util._color_cycle` (`util.py:27`) is the Python mirror of the C `AutoColor` table (identical 40
  indices), used by `util.cbc`.

### Examples
```
color auto, elem C          # give this object the next cycle colour
set auto_color_next, 0      # reset the cycle
```

### Related
by-chain colouring, colour-index integer space, `set`

### Source
`packages/engine/layer1/Color.cpp:35` (`AutoColor`), `Color.cpp:140` (`ColorGetNext`); Python mirror `packages/engine/modules/pymol/util.py:27`

---

## Colour-index integer space

### Purpose
The single flat integer namespace every colour reference resolves into — and how `set_color`
extends it without breaking the load-bearing hardcoded indices.

### Behaviour
- The colour table is one vector of RGB slots (`5388` in this fork: 188 named + 5200 generated
  band colours). Names with no digits are the "real" palette; the `sNNN/rNNN/cNNN/wNNN/oNNN` bands
  back `spectrum`.
- Negative indices are **specials**: `-1 default`, `-2 auto`, `-3 current`, `-4 atomic`,
  `-5 object`, `-6 front`, `-7 back`; indices `<= -10` are **ramp objects** (`ext = -10 - index`).
- `0x`-prefixed values are inline TRGB colours (`0x40RRGGBB`), with transparency packed into the
  top bits — this is how `spectrumany` writes per-atom colours without table slots.
- **Indices are frozen** — menus hardcode them (e.g. `grey80 = 134`, `gray80 = 4236`) and `.pse`
  sessions serialize them. `set_color` therefore appends a *new* slot for a new name, or overwrites
  the RGB of an existing slot in place (index preserved). This is what lets custom colours survive
  session round-trips.

### Examples
```
set_color mycol, [0.3, 0.6, 0.9]   # appends a new index
color 5, all                       # colour by raw index (yellow)
color 0x40FF8000, all              # inline TRGB orange
```

### Related
`set_color`, ramp objects, special colours

### Source
`packages/engine/layer1/Color.cpp:661` (`ColorGetIndex`), `Color.h:36` (special indices), `Color.cpp:1024` (named table); TS `packages/engine-ts/src/exec/color.ts:79`

---

## Built-in spectrum palettes

### Purpose
The named palettes `spectrum` (and `chainbow`, `color_by_area`) accept — 57 entries defined in
`constants_palette.py`, each a `(prefix, digits, first, last)` tuple that carves a slice out of one
of the generated 1000-colour bands (`prefix ∈ o|s|r|c|w`).

### Behaviour
The 57 palettes, grouped by family:

- **Rainbows** (`o`/`s` band): `rainbow_cycle` `('o',3,0,999)`, `rainbow_cycle_rev`
  `('o',3,999,0)`, `rainbow` `('o',3,107,893)`, `rainbow_rev` `('o',3,893,107)`, `rainbow2`
  `('s',3,167,833)`, `rainbow2_rev` `('s',3,833,167)`.
- **Offset/reversed spectrum** (`r` band): `gcbmry` `('r',3,166,999)`, `yrmbcg` `('r',3,999,166)`,
  `cbmr` `('r',3,166,833)`, `rmbc` `('r',3,833,166)`.
- **Green–yellow–red** (`s` band): `green_yellow_red` `('s',3,500,833)`, `red_yellow_green`
  `('s',3,833,500)`.
- **White-separated complementary** (`w` band): `yellow_white_blue`, `blue_white_yellow`,
  `blue_white_red`, `red_white_blue`, `red_white_green`, `green_white_red`, `green_white_magenta`,
  `magenta_white_green`, `magenta_white_cyan`, `cyan_white_magenta`, `cyan_white_yellow`,
  `yellow_cyan_white`, `yellow_white_green`, `green_white_yellow`, `green_white_blue`,
  `blue_white_green`, `blue_white_magenta`, `magenta_white_blue`, `magenta_white_yellow`,
  `yellow_white_magenta`, `yellow_white_red`, `red_white_yellow`, `red_white_cyan`,
  `cyan_white_red`.
- **Two-colour complementary** (`c` band): `yellow_blue`, `blue_yellow`, `blue_red`, `red_blue`,
  `red_green`, `green_red`, `green_magenta`, `magenta_green`, `magenta_cyan`, `cyan_magenta`,
  `cyan_yellow`, `yellow_cyan`, `yellow_green`, `green_yellow`, `green_blue`, `blue_green`,
  `blue_magenta`, `magenta_blue`, `magenta_yellow`, `yellow_magenta`, `yellow_red`, `red_yellow`,
  `red_cyan`, `cyan_red`.

`palette_sc = Shortcut(palette_dict.keys())` provides abbreviation/prefix resolution, so a unique
prefix (e.g. `blue_w`) also resolves. The TS engine mirrors all 57 as `PALETTE_DICT`.

### Examples
```
spectrum b, blue_white_red
spectrum count, rainbow_cycle, byres=1
spectrum q, green_red
```

### Related
`spectrum`, `spectrumany`, colour-index integer space

### Source
`packages/engine/modules/pymol/constants_palette.py:1`; TS `packages/engine-ts/src/cmd/coloring.ts:102`
