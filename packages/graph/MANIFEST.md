# PyMOL Feature Manifest

Every user-facing feature of PyMOL as reproduced/targeted by **tenmol**, one row each.
Generated from the per-feature deep-dive docs under `features/` — do not hand-edit; run
`node packages/graph/scripts/assemble-manifest.mjs`. Machine-readable form: `manifest.json`.

**1643 features.**

## By kind

| Kind | Count |
| --- | --- |
| setting | 779 |
| command | 432 |
| color | 178 |
| feature | 102 |
| selection | 87 |
| wizard | 25 |
| preset | 22 |
| representation | 18 |

## By category

| Category | Count |
| --- | --- |
| settings | 723 |
| coloring | 205 |
| selecting | 92 |
| editing-building | 60 |
| ui-gui | 60 |
| movies-scenes-states | 58 |
| sculpting-minimization | 56 |
| viewing-camera | 39 |
| representations-display | 38 |
| file-io | 36 |
| wizard | 35 |
| querying | 34 |
| control-flow-system | 32 |
| rendering-export | 29 |
| internal | 28 |
| presets | 28 |
| maps-volumes | 26 |
| fitting-alignment | 18 |
| objects-groups | 18 |
| symmetry | 12 |
| measurement | 10 |
| labeling | 3 |
| properties | 2 |
| cgo | 1 |

## cgo (1)

| Feature | Kind | Summary | Parity | Doc |
| --- | --- | --- | --- | --- |
| `load_cgo` `load_cgo(object, name, state, finish, discrete)` | command | Load a Compiled Graphics Object (a flat list of floats built from cgo.py constants) as a named object. | unknown | [doc](features/commands/load_cgo.md) |

## coloring (205)

| Feature | Kind | Summary | Parity | Doc |
| --- | --- | --- | --- | --- |
| `_deepsalmon` | color | Built-in named color | implemented | [doc](features/topics/named-colors.md) |
| `actinium` | color | Element color for Actinium | implemented | [doc](features/topics/named-colors.md) |
| `aluminum` | color | Element color for Aluminum | implemented | [doc](features/topics/named-colors.md) |
| `americium` | color | Element color for Americium | implemented | [doc](features/topics/named-colors.md) |
| `antimony` | color | Element color for Antimony | implemented | [doc](features/topics/named-colors.md) |
| `aquamarine` | color | Built-in named color | implemented | [doc](features/topics/named-colors.md) |
| `argon` | color | Element color for Argon | implemented | [doc](features/topics/named-colors.md) |
| `arsenic` | color | Element color for Arsenic | implemented | [doc](features/topics/named-colors.md) |
| `astatine` | color | Element color for Astatine | implemented | [doc](features/topics/named-colors.md) |
| `barium` | color | Element color for Barium | implemented | [doc](features/topics/named-colors.md) |
| `berkelium` | color | Element color for Berkelium | implemented | [doc](features/topics/named-colors.md) |
| `beryllium` | color | Element color for Beryllium | implemented | [doc](features/topics/named-colors.md) |
| `bismuth` | color | Element color for Bismuth | implemented | [doc](features/topics/named-colors.md) |
| `black` | color | Built-in named color | implemented | [doc](features/topics/named-colors.md) |
| `blue` | color | Built-in named color | implemented | [doc](features/topics/named-colors.md) |
| `bluewhite` | color | Built-in named color | implemented | [doc](features/topics/named-colors.md) |
| `bohrium` | color | Element color for Bohrium | implemented | [doc](features/topics/named-colors.md) |
| `boron` | color | Element color for Boron | implemented | [doc](features/topics/named-colors.md) |
| `brightorange` | color | Built-in named color | implemented | [doc](features/topics/named-colors.md) |
| `bromine` | color | Element color for Bromine | implemented | [doc](features/topics/named-colors.md) |
| `brown` | color | Built-in named color | implemented | [doc](features/topics/named-colors.md) |
| `cadmium` | color | Element color for Cadmium | implemented | [doc](features/topics/named-colors.md) |
| `calcium` | color | Element color for Calcium | implemented | [doc](features/topics/named-colors.md) |
| `californium` | color | Element color for Californium | implemented | [doc](features/topics/named-colors.md) |
| `carbon` | color | Element color for Carbon | implemented | [doc](features/topics/named-colors.md) |
| `cerium` | color | Element color for Cerium | implemented | [doc](features/topics/named-colors.md) |
| `cesium` | color | Element color for Cesium | implemented | [doc](features/topics/named-colors.md) |
| `chartreuse` | color | Built-in named color | implemented | [doc](features/topics/named-colors.md) |
| `chlorine` | color | Element color for Chlorine | implemented | [doc](features/topics/named-colors.md) |
| `chocolate` | color | Built-in named color | implemented | [doc](features/topics/named-colors.md) |
| `chromium` | color | Element color for Chromium | implemented | [doc](features/topics/named-colors.md) |
| `cobalt` | color | Element color for Cobalt | implemented | [doc](features/topics/named-colors.md) |
| `copper` | color | Element color for Copper | implemented | [doc](features/topics/named-colors.md) |
| `curium` | color | Element color for Curium | implemented | [doc](features/topics/named-colors.md) |
| `cyan` | color | Built-in named color | implemented | [doc](features/topics/named-colors.md) |
| `darksalmon` | color | Built-in named color | implemented | [doc](features/topics/named-colors.md) |
| `dash` | color | Built-in named color | implemented | [doc](features/topics/named-colors.md) |
| `deepblue` | color | Built-in named color | implemented | [doc](features/topics/named-colors.md) |
| `deepolive` | color | Built-in named color | implemented | [doc](features/topics/named-colors.md) |
| `deeppurple` | color | Built-in named color | implemented | [doc](features/topics/named-colors.md) |
| `deepsalmon` | color | Built-in named color | implemented | [doc](features/topics/named-colors.md) |
| `deepteal` | color | Built-in named color | implemented | [doc](features/topics/named-colors.md) |
| `density` | color | Built-in named color | implemented | [doc](features/topics/named-colors.md) |
| `deuterium` | color | Element color for Deuterium | implemented | [doc](features/topics/named-colors.md) |
| `dirtyviolet` | color | Built-in named color | implemented | [doc](features/topics/named-colors.md) |
| `dubnium` | color | Element color for Dubnium | implemented | [doc](features/topics/named-colors.md) |
| `dysprosium` | color | Element color for Dysprosium | implemented | [doc](features/topics/named-colors.md) |
| `einsteinium` | color | Element color for Einsteinium | implemented | [doc](features/topics/named-colors.md) |
| `erbium` | color | Element color for Erbium | implemented | [doc](features/topics/named-colors.md) |
| `europium` | color | Element color for Europium | implemented | [doc](features/topics/named-colors.md) |
| `fermium` | color | Element color for Fermium | implemented | [doc](features/topics/named-colors.md) |
| `firebrick` | color | Built-in named color | implemented | [doc](features/topics/named-colors.md) |
| `fluorine` | color | Element color for Fluorine | implemented | [doc](features/topics/named-colors.md) |
| `forest` | color | Built-in named color | implemented | [doc](features/topics/named-colors.md) |
| `francium` | color | Element color for Francium | implemented | [doc](features/topics/named-colors.md) |
| `gadolinium` | color | Element color for Gadolinium | implemented | [doc](features/topics/named-colors.md) |
| `gallium` | color | Element color for Gallium | implemented | [doc](features/topics/named-colors.md) |
| `germanium` | color | Element color for Germanium | implemented | [doc](features/topics/named-colors.md) |
| `gold` | color | Element color for Gold | implemented | [doc](features/topics/named-colors.md) |
| `gray` | color | Built-in named color | implemented | [doc](features/topics/named-colors.md) |
| `green` | color | Built-in named color | implemented | [doc](features/topics/named-colors.md) |
| `greencyan` | color | Built-in named color | implemented | [doc](features/topics/named-colors.md) |
| `grey` | color | Built-in named color | implemented | [doc](features/topics/named-colors.md) |
| `hafnium` | color | Element color for Hafnium | implemented | [doc](features/topics/named-colors.md) |
| `hassium` | color | Element color for Hassium | implemented | [doc](features/topics/named-colors.md) |
| `helium` | color | Element color for Helium | implemented | [doc](features/topics/named-colors.md) |
| `holmium` | color | Element color for Holmium | implemented | [doc](features/topics/named-colors.md) |
| `hotpink` | color | Built-in named color | implemented | [doc](features/topics/named-colors.md) |
| `hydrogen` | color | Element color for Hydrogen | implemented | [doc](features/topics/named-colors.md) |
| `indium` | color | Element color for Indium | implemented | [doc](features/topics/named-colors.md) |
| `iodine` | color | Element color for Iodine | implemented | [doc](features/topics/named-colors.md) |
| `iridium` | color | Element color for Iridium | implemented | [doc](features/topics/named-colors.md) |
| `iron` | color | Element color for Iron | implemented | [doc](features/topics/named-colors.md) |
| `krypton` | color | Element color for Krypton | implemented | [doc](features/topics/named-colors.md) |
| `lanthanum` | color | Element color for Lanthanum | implemented | [doc](features/topics/named-colors.md) |
| `lawrencium` | color | Element color for Lawrencium | implemented | [doc](features/topics/named-colors.md) |
| `lead` | color | Element color for Lead | implemented | [doc](features/topics/named-colors.md) |
| `lightblue` | color | Built-in named color | implemented | [doc](features/topics/named-colors.md) |
| `lightmagenta` | color | Built-in named color | implemented | [doc](features/topics/named-colors.md) |
| `lightorange` | color | Built-in named color | implemented | [doc](features/topics/named-colors.md) |
| `lightpink` | color | Built-in named color | implemented | [doc](features/topics/named-colors.md) |
| `lightteal` | color | Built-in named color | implemented | [doc](features/topics/named-colors.md) |
| `lime` | color | Built-in named color | implemented | [doc](features/topics/named-colors.md) |
| `limegreen` | color | Built-in named color | implemented | [doc](features/topics/named-colors.md) |
| `limon` | color | Built-in named color | implemented | [doc](features/topics/named-colors.md) |
| `lithium` | color | Element color for Lithium | implemented | [doc](features/topics/named-colors.md) |
| `lonepair` | color | Element color for Lone pair | implemented | [doc](features/topics/named-colors.md) |
| `lutetium` | color | Element color for Lutetium | implemented | [doc](features/topics/named-colors.md) |
| `magenta` | color | Built-in named color | implemented | [doc](features/topics/named-colors.md) |
| `magnesium` | color | Element color for Magnesium | implemented | [doc](features/topics/named-colors.md) |
| `manganese` | color | Element color for Manganese | implemented | [doc](features/topics/named-colors.md) |
| `marine` | color | Built-in named color | implemented | [doc](features/topics/named-colors.md) |
| `meitnerium` | color | Element color for Meitnerium | implemented | [doc](features/topics/named-colors.md) |
| `mendelevium` | color | Element color for Mendelevium | implemented | [doc](features/topics/named-colors.md) |
| `mercury` | color | Element color for Mercury | implemented | [doc](features/topics/named-colors.md) |
| `molybdenum` | color | Element color for Molybdenum | implemented | [doc](features/topics/named-colors.md) |
| `neodymium` | color | Element color for Neodymium | implemented | [doc](features/topics/named-colors.md) |
| `neon` | color | Element color for Neon | implemented | [doc](features/topics/named-colors.md) |
| `neptunium` | color | Element color for Neptunium | implemented | [doc](features/topics/named-colors.md) |
| `nickel` | color | Element color for Nickel | implemented | [doc](features/topics/named-colors.md) |
| `niobium` | color | Element color for Niobium | implemented | [doc](features/topics/named-colors.md) |
| `nitrogen` | color | Element color for Nitrogen | implemented | [doc](features/topics/named-colors.md) |
| `nobelium` | color | Element color for Nobelium | implemented | [doc](features/topics/named-colors.md) |
| `olive` | color | Built-in named color | implemented | [doc](features/topics/named-colors.md) |
| `orange` | color | Built-in named color | implemented | [doc](features/topics/named-colors.md) |
| `osmium` | color | Element color for Osmium | implemented | [doc](features/topics/named-colors.md) |
| `oxygen` | color | Element color for Oxygen | implemented | [doc](features/topics/named-colors.md) |
| `palecyan` | color | Built-in named color | implemented | [doc](features/topics/named-colors.md) |
| `palegreen` | color | Built-in named color | implemented | [doc](features/topics/named-colors.md) |
| `paleyellow` | color | Built-in named color | implemented | [doc](features/topics/named-colors.md) |
| `palladium` | color | Element color for Palladium | implemented | [doc](features/topics/named-colors.md) |
| `phosphorus` | color | Element color for Phosphorus | implemented | [doc](features/topics/named-colors.md) |
| `pink` | color | Built-in named color | implemented | [doc](features/topics/named-colors.md) |
| `platinum` | color | Element color for Platinum | implemented | [doc](features/topics/named-colors.md) |
| `plutonium` | color | Element color for Plutonium | implemented | [doc](features/topics/named-colors.md) |
| `polonium` | color | Element color for Polonium | implemented | [doc](features/topics/named-colors.md) |
| `potassium` | color | Element color for Potassium | implemented | [doc](features/topics/named-colors.md) |
| `praseodymium` | color | Element color for Praseodymium | implemented | [doc](features/topics/named-colors.md) |
| `promethium` | color | Element color for Promethium | implemented | [doc](features/topics/named-colors.md) |
| `protactinium` | color | Element color for Protactinium | implemented | [doc](features/topics/named-colors.md) |
| `pseudoatom` | color | Element color for Pseudoatom | implemented | [doc](features/topics/named-colors.md) |
| `purple` | color | Built-in named color | implemented | [doc](features/topics/named-colors.md) |
| `purpleblue` | color | Built-in named color | implemented | [doc](features/topics/named-colors.md) |
| `radium` | color | Element color for Radium | implemented | [doc](features/topics/named-colors.md) |
| `radon` | color | Element color for Radon | implemented | [doc](features/topics/named-colors.md) |
| `raspberry` | color | Built-in named color | implemented | [doc](features/topics/named-colors.md) |
| `red` | color | Built-in named color | implemented | [doc](features/topics/named-colors.md) |
| `rhenium` | color | Element color for Rhenium | implemented | [doc](features/topics/named-colors.md) |
| `rhodium` | color | Element color for Rhodium | implemented | [doc](features/topics/named-colors.md) |
| `rubidium` | color | Element color for Rubidium | implemented | [doc](features/topics/named-colors.md) |
| `ruby` | color | Built-in named color | implemented | [doc](features/topics/named-colors.md) |
| `ruthenium` | color | Element color for Ruthenium | implemented | [doc](features/topics/named-colors.md) |
| `rutherfordium` | color | Element color for Rutherfordium | implemented | [doc](features/topics/named-colors.md) |
| `salmon` | color | Built-in named color | implemented | [doc](features/topics/named-colors.md) |
| `samarium` | color | Element color for Samarium | implemented | [doc](features/topics/named-colors.md) |
| `sand` | color | Built-in named color | implemented | [doc](features/topics/named-colors.md) |
| `scandium` | color | Element color for Scandium | implemented | [doc](features/topics/named-colors.md) |
| `seaborgium` | color | Element color for Seaborgium | implemented | [doc](features/topics/named-colors.md) |
| `selenium` | color | Element color for Selenium | implemented | [doc](features/topics/named-colors.md) |
| `silicon` | color | Element color for Silicon | implemented | [doc](features/topics/named-colors.md) |
| `silver` | color | Element color for Silver | implemented | [doc](features/topics/named-colors.md) |
| `skyblue` | color | Built-in named color | implemented | [doc](features/topics/named-colors.md) |
| `slate` | color | Built-in named color | implemented | [doc](features/topics/named-colors.md) |
| `smudge` | color | Built-in named color | implemented | [doc](features/topics/named-colors.md) |
| `sodium` | color | Element color for Sodium | implemented | [doc](features/topics/named-colors.md) |
| `splitpea` | color | Built-in named color | implemented | [doc](features/topics/named-colors.md) |
| `strontium` | color | Element color for Strontium | implemented | [doc](features/topics/named-colors.md) |
| `sulfur` | color | Element color for Sulfur | implemented | [doc](features/topics/named-colors.md) |
| `tantalum` | color | Element color for Tantalum | implemented | [doc](features/topics/named-colors.md) |
| `teal` | color | Built-in named color | implemented | [doc](features/topics/named-colors.md) |
| `technetium` | color | Element color for Technetium | implemented | [doc](features/topics/named-colors.md) |
| `tellurium` | color | Element color for Tellurium | implemented | [doc](features/topics/named-colors.md) |
| `terbium` | color | Element color for Terbium | implemented | [doc](features/topics/named-colors.md) |
| `thallium` | color | Element color for Thallium | implemented | [doc](features/topics/named-colors.md) |
| `thorium` | color | Element color for Thorium | implemented | [doc](features/topics/named-colors.md) |
| `thulium` | color | Element color for Thulium | implemented | [doc](features/topics/named-colors.md) |
| `tin` | color | Element color for Tin | implemented | [doc](features/topics/named-colors.md) |
| `titanium` | color | Element color for Titanium | implemented | [doc](features/topics/named-colors.md) |
| `tungsten` | color | Element color for Tungsten | implemented | [doc](features/topics/named-colors.md) |
| `tv_blue` | color | Built-in named color | implemented | [doc](features/topics/named-colors.md) |
| `tv_green` | color | Built-in named color | implemented | [doc](features/topics/named-colors.md) |
| `tv_orange` | color | Built-in named color | implemented | [doc](features/topics/named-colors.md) |
| `tv_red` | color | Built-in named color | implemented | [doc](features/topics/named-colors.md) |
| `tv_yellow` | color | Built-in named color | implemented | [doc](features/topics/named-colors.md) |
| `uranium` | color | Element color for Uranium | implemented | [doc](features/topics/named-colors.md) |
| `vanadium` | color | Element color for Vanadium | implemented | [doc](features/topics/named-colors.md) |
| `violet` | color | Built-in named color | implemented | [doc](features/topics/named-colors.md) |
| `violetpurple` | color | Built-in named color | implemented | [doc](features/topics/named-colors.md) |
| `warmpink` | color | Built-in named color | implemented | [doc](features/topics/named-colors.md) |
| `wheat` | color | Built-in named color | implemented | [doc](features/topics/named-colors.md) |
| `white` | color | Built-in named color | implemented | [doc](features/topics/named-colors.md) |
| `xenon` | color | Element color for Xenon | implemented | [doc](features/topics/named-colors.md) |
| `yellow` | color | Built-in named color | implemented | [doc](features/topics/named-colors.md) |
| `yelloworange` | color | Built-in named color | implemented | [doc](features/topics/named-colors.md) |
| `ytterbium` | color | Element color for Ytterbium | implemented | [doc](features/topics/named-colors.md) |
| `yttrium` | color | Element color for Yttrium | implemented | [doc](features/topics/named-colors.md) |
| `zinc` | color | Element color for Zinc | implemented | [doc](features/topics/named-colors.md) |
| `zirconium` | color | Element color for Zirconium | implemented | [doc](features/topics/named-colors.md) |
| `color` `color(color, selection='(all)', quiet=1, flags=0)` | command | Changes the colour of objects or atoms; the primary colour assigner accepting names, indices, hex, specials, or ramp objects. | implemented | [doc](features/topics/coloring-system.md#color) |
| `color_deep` `color_deep(color, name='all', quiet=1)` | command | Unsets all object- and atom-level colour settings then applies a colour, clearing every per-rep override. | implemented | [doc](features/topics/coloring-system.md#color_deep) |
| `colour` `colour(color, selection='(all)', quiet=1, flags=0)` | command | British-spelling alias of color; changes the color of objects or atoms. | implemented | [doc](features/commands/colour.md) |
| `del_colorection` `del_colorection(dict, key)` | command | Deletes a stored colorection (named color-by-selection snapshot) entry. | implemented | [doc](features/commands/del_colorection.md) |
| `desaturate` `desaturate(selection='all', a=0.5, quiet=1)` | command | Desaturates a selection's colours toward grey — an incentive-only feature, so Open-Source PyMOL and the TS engine both raise IncentiveOnlyException rather than recolouring. | implemented | [doc](features/commands/desaturate.md) |
| `get_color_indices` `get_color_indices(all=0)` | command | Returns the list of (name, index) pairs for the color table. | implemented | [doc](features/commands/get_color_indices.md) |
| `get_colorection` `get_colorection(key)` | command | Snapshots the current colour of everything under a key, for scene colour capture. | implemented | [doc](features/topics/coloring-system.md#get_colorection) |
| `get_object_color_index` `get_object_color_index(name)` | command | Returns the integer color index assigned to a named object. | implemented | [doc](features/commands/get_object_color_index.md) |
| `ramp_new` `ramp_new(name, map_name, range=[-1.0, 0.0, 1.0], color=['red', [1.0, 1.0, 1.0], 'blue'], state=1, selection='', beyond=2.0, within=6.0, sigma=2.0, zero=1, quiet=1)` | command | Create a color-ramp gadget object that colors atoms by map potential or by proximity to a molecular object. | implemented | [doc](features/commands/ramp_new.md) |
| `ramp_update` `ramp_update(name, range=[], color=[], quiet=1)` | command | Update the value range and/or colors of an existing color-ramp object. | implemented | [doc](features/commands/ramp_update.md) |
| `recolor` `recolor(selection='all', representation='everything')` | command | Forces reapplication of colours to already-built geometry; required after set_color redefines a colour in use. | implemented | [doc](features/topics/coloring-system.md#recolor--recolour) |
| `recolour` `recolour(selection='all', representation='everything')` | command | British-spelling alias of recolor - reapplies colors to existing objects. | implemented | [doc](features/commands/recolour.md) |
| `set_color` `set_color(name, rgb, mode=0, quiet=1)` | command | Defines a new colour (or redefines an existing one) from RGB components, extending the colour-index table. | implemented | [doc](features/topics/coloring-system.md#set_color) |
| `set_colorection` `set_colorection(dict, key)` | command | Restores a saved set of color assignments (a colorection) from a dict under a given key. | implemented | [doc](features/commands/set_colorection.md) |
| `set_colour` `set_colour(name, rgb, mode=0, quiet=1)` | command | British-spelling alias of set_color; defines a named color from RGB components. | implemented | [doc](features/commands/set_colour.md) |
| `set_object_color` `set_object_color(name, color, quiet=1)` | command | Sets an object's whole-object color attribute (distinct from per-atom colors). | implemented | [doc](features/commands/set_object_color.md) |
| `space` `space(space='', gamma=1.0, quiet=0)` | command | Selects the working color palette/space (rgb, cmyk, or pymol) to keep on-screen colors print/video-safe. | unknown | [doc](features/commands/space.md) |
| `spectrum` `spectrum(expression='count', palette='rainbow', selection='(all)', minimum=None, maximum=None, byres=0, quiet=1, interpolation='rgb')` | command | Colors atoms with a spectrum of colors based on an atomic property such as count, B-factor, occupancy, or partial charge. | implemented | [doc](features/commands/spectrum.md) |
| `spectrumany` `spectrumany(expression, colors, selection='(all)', minimum=None, maximum=None, quiet=1, interpolation='rgb')` | command | Pure-Python spectrum fallback accepting arbitrary colour lists and rgb/hls/hsv interpolation; drives spectrum for non-alphabetic expressions. | planned | [doc](features/topics/coloring-system.md#spectrumany) |
| `auto-colour-cycle` | feature | The auto/current special colours and 40-colour cycle (auto_color / auto_color_next) that give each new object or chain a fresh distinguishable colour. | partial | [doc](features/topics/coloring-system.md#auto-colour-cycle-auto_color--auto_color_next) |
| `builtin-spectrum-palettes` | feature | The 57 named palettes spectrum accepts, each a (prefix, digits, first, last) slice of a generated 1000-colour band (o/s/r/c/w families). | implemented | [doc](features/topics/coloring-system.md#built-in-spectrum-palettes) |
| `colour-by-chain` | feature | Assign a distinct colour per chain via util.cbc/color_chains, per object via color_objs, or an N-to-C rainbow per chain via chainbow. | implemented | [doc](features/topics/coloring-system.md#colour-by-chain) |
| `colour-by-rep` | feature | Colour a representation independently by writing per-rep colour settings (from rep_setting_lists) rather than atom colours. | partial | [doc](features/topics/coloring-system.md#colour-by-representation-by-rep) |
| `colour-by-secondary-structure` | feature | Colour atoms by secondary-structure type (helix/sheet/loop) via util.cbss or spectrum ss. | implemented | [doc](features/topics/coloring-system.md#colour-by-secondary-structure) |
| `colour-index-integer-space` | feature | The single flat integer namespace all colour references resolve into (named + generated bands + negative specials + ramp extensions + inline TRGB), and how set_color extends it without breaking frozen indices. | implemented | [doc](features/topics/coloring-system.md#colour-index-integer-space) |
| `element-cpk-colouring` | feature | Colour atoms by chemical element (CPK) via the 'atomic' special colour and the util.cb* / cnc helper family, typically keeping a chosen carbon colour. | implemented | [doc](features/topics/coloring-system.md#element--cpk-atomic-colouring) |
| `spectrum-vs-spectrumany` | feature | The two-tier spectrum dispatch: fast C-backed spectrum for named palettes on alphabetic expressions, pure-Python spectrumany fallback for colour lists, non-alpha expressions, and hls/hsv interpolation. | partial | [doc](features/topics/coloring-system.md#spectrum-vs-spectrumany) |

## control-flow-system (32)

| Feature | Kind | Summary | Parity | Doc |
| --- | --- | --- | --- | --- |
| `abort` `abort()` | command | Abruptly terminates execution of the running PyMOL command script. | implemented | [doc](features/commands/abort.md) |
| `api` `api(name)` | command | Prints the fully-qualified module.function name that implements a given PyMOL command. | implemented | [doc](features/commands/api.md) |
| `async_` `async_(func, *args, **kwargs)` | command | Runs a function on a background thread while showing a "please wait..." message. | internal | [doc](features/commands/async_.md) |
| `block_flush` `block_flush()` | command | Internal API-lock helper that suppresses command-queue flushing. | internal | [doc](features/commands/block_flush.md) |
| `cd` `cd(dir='~', complain=1, quiet=1)` | command | Changes the current working directory. | partial | [doc](features/commands/cd.md) |
| `cls` `cls()` | command | Clears the text output buffer. | partial | [doc](features/commands/cls.md) |
| `commands` `commands()` | command | Prints a categorised cheat-sheet of PyMOL's most common commands. | implemented | [doc](features/commands/commands.md) |
| `decline` `decline()` | command | Internal method that declines a session-file security prompt. | internal | [doc](features/commands/decline.md) |
| `exp_path` `exp_path(path)` | command | Expands user (~) and environment-variable references in a filesystem path. | unknown | [doc](features/commands/exp_path.md) |
| `extendaa` `extendaa(*arg)` | command | API-only decorator that registers a Python function as a PyMOL command with argument auto-completion. | internal | [doc](features/commands/extendaa.md) |
| `fb_action` | command | Internal enum container holding the numeric codes for feedback actions (set/enable/disable) used by the feedback command. | internal | [doc](features/commands/fb_action.md) |
| `fb_mask` | command | Internal enum container holding the numeric codes for feedback output categories (masks) used by the feedback command. | internal | [doc](features/commands/fb_mask.md) |
| `fb_module` | command | Internal enum container holding the numeric codes for PyMOL feedback modules (subsystems) used by the feedback command. | internal | [doc](features/commands/fb_module.md) |
| `feedback` `feedback(action='?', module='?', mask='?')` | command | Adjusts how much diagnostic output PyMOL prints, per subsystem module and per output category. | unknown | [doc](features/commands/feedback.md) |
| `get_progress` `get_progress(reset=0)` | command | Return the fractional progress of a long-running task, optionally resetting the tracker. | unknown | [doc](features/commands/get_progress.md) |
| `help` `help(command='commands')` | command | Prints the online help (docstring) for a given command or topic. | partial | [doc](features/commands/help.md) |
| `interrupt` `interrupt()` | command | Signals the engine to interrupt a running operation (asynchronous, no locking). | internal | [doc](features/commands/interrupt.md) |
| `LockCM` `LockCM(_self=cmd)` | command | Context manager that acquires and releases PyMOL's API lock around a block of code. | internal | [doc](features/commands/LockCM.md) |
| `log` `log(text, alt_text=None)` | command | Write a command (or its Python equivalent) to the currently open log file. | partial | [doc](features/commands/log.md) |
| `log_close` `log_close()` | command | Close the currently open log file and turn logging off. | partial | [doc](features/commands/log_close.md) |
| `log_open` `log_open(filename='log.pml', mode='w')` | command | Open a log file for writing, selecting .pml or .py logging mode from the filename extension. | partial | [doc](features/commands/log_open.md) |
| `ls` `ls(pattern=None)` | command | Lists the contents of the current working directory, optionally filtered by a glob pattern. | implemented | [doc](features/commands/ls.md) |
| `pwd` `pwd()` | command | Print the current working directory to the log. | implemented | [doc](features/commands/pwd.md) |
| `python_help` `python_help(string)` | command | Help stub explaining how Python keywords and blocks work inside the PyMOL command language. | unknown | [doc](features/commands/python_help.md) |
| `reinitialize` `reinitialize(what='everything', object='')` | command | Reset PyMOL by deleting all objects and restoring default settings (with selectable scope). | implemented | [doc](features/commands/reinitialize.md) |
| `resume` `resume(filename)` | command | Replays an existing log file and reopens it in append mode for continued recording. | planned | [doc](features/commands/resume.md) |
| `SafeEvalNS` `SafeEvalNS()` | command | Namespace object that makes eval() resolve any bare name to its own string. | internal | [doc](features/commands/SafeEvalNS.md) |
| `Shortcut` `Shortcut(keywords=None, filter_leading_underscore=True)` | command | Abbreviation/auto-completion engine that resolves unambiguous prefixes of a keyword set. | internal | [doc](features/commands/Shortcut.md) |
| `show_help` `show_help(cmmd)` | command | Internal helper that prints help text for a command keyword (backs the 'help' command). | internal | [doc](features/commands/show_help.md) |
| `spawn` `spawn(filename, namespace='module')` | command | Launches a Python script in a new background thread that runs concurrently with the interpreter. | implemented | [doc](features/commands/spawn.md) |
| `sync` `sync(timeout=1.0, poll=0.05)` | command | API-only barrier that blocks until all queued commands have finished executing, with a timeout. | implemented | [doc](features/commands/sync.md) |
| `unblock_flush` `unblock_flush()` | command | Internal helper that re-enables flushing of the command queue when the API lock is released. | internal | [doc](features/commands/unblock_flush.md) |

## editing-building (60)

| Feature | Kind | Summary | Parity | Doc |
| --- | --- | --- | --- | --- |
| `add_bond` `add_bond(oname, index1, index2, order=1)` | command | API-only function that adds a bond between two atoms specified by 1-based atom index. | implemented | [doc](features/commands/add_bond.md) |
| `alphatoall` `alphatoall(selection='polymer', properties='b', operator='byca', quiet=1)` | command | Copies a per-residue property from each residue's CA atom out to all atoms in that residue. | implemented | [doc](features/commands/alphatoall.md) |
| `alter_list` `alter_list(object, expr_list, quiet=1, space=None)` | command | Unsupported bulk variant of alter that applies a list of per-atom expressions to an object. | internal | [doc](features/commands/alter_list.md) |
| `alter_state` `alter_state(state, selection, expression, quiet=1, space=None, atomic=1)` | command | Changes per-atom coordinates and flags in a given state by evaluating an expression per atom. | implemented | [doc](features/commands/alter_state.md) |
| `assign_stereo` `assign_stereo(selection='all', state=-1, method='', quiet=1, prop='stereo')` | command | Assigns the R/S stereo atom property, requiring a Schrodinger Suite or RDKit backend. | partial | [doc](features/topics/editing-building.md#assign_stereo) |
| `attach` `attach(element, geometry, valence, name='', quiet=1)` | command | Adds a single new atom onto the currently picked atom with a given geometry and valence. | implemented | [doc](features/commands/attach.md) |
| `bond` `bond(atom1='pk1', atom2='pk2', order=1, quiet=1, symop='')` | command | Creates a new bond between two single-atom selections (default pk1/pk2), within the same object. | implemented | [doc](features/topics/editing-building.md#bond) |
| `check` `check(selection=None, preserve=0)` | command | Unsupported stub that would assign forcefield parameters to a selection. | partial | [doc](features/commands/check.md) |
| `cycle_valence` `cycle_valence(h_fill=1, quiet=1)` | command | Cycles the bond order (single/double/triple/aromatic) of the currently picked bond. | implemented | [doc](features/commands/cycle_valence.md) |
| `delete` `delete(name)` | command | Removes whole objects and named selections (not individual atoms). | implemented | [doc](features/topics/editing-building.md#delete) |
| `deprotect` `deprotect(selection='(all)', quiet=1)` | command | Clears the protected flag on atoms, reversing the protect command. | implemented | [doc](features/commands/deprotect.md) |
| `drag` `drag(selection=None, wizard=1, edit=1, quiet=1, mode=-1)` | command | Activates mouse dragging of a selection's atom coordinates, using camera-like mouse controls. | unknown | [doc](features/commands/drag.md) |
| `dss` `dss(selection='(all)', state=0, context=None, preserve=0, quiet=1)` | command | Assigns secondary structure (helix/sheet/loop) from backbone geometry and hydrogen-bonding patterns. | implemented | [doc](features/commands/dss.md) |
| `edit` `edit(selection1='', selection2='none', selection3='none', selection4='none', pkresi=0, pkbond=1, quiet=1)` | command | Picks one or more atoms (or a bond) for editing, populating the (pk1..pk4) picked selections. | implemented | [doc](features/commands/edit.md) |
| `fab` `fab(input, name=None, mode='peptide', resi=1, chain='', segi='', state=-1, dir=1, hydro=-1, ss=0, async_=0, quiet=1)` | command | Builds a peptide object from a one-letter amino-acid sequence, optionally with a preset secondary structure. | implemented | [doc](features/commands/fab.md) |
| `fix_chemistry` `fix_chemistry(selection1='all', selection2='all', invalidate=1, quiet=1)` | command | Best-effort repair of bond orders/valences/atoms around a modified site (unsupported upstream). | implemented | [doc](features/topics/editing-building.md#fix_chemistry) |
| `fnab` `fnab(input, name=None, mode='DNA', form='B', dbl_helix=1)` | command | Builds a nucleic-acid object from a one-letter sequence as DNA or RNA, in A or B form, optionally as a double helix. | implemented | [doc](features/commands/fnab.md) |
| `fragment` `fragment(name, object=None, origin=1, zoom=0, quiet=1)` | command | Retrieves a 3D structure from the built-in fragment library (currently mostly amino acids). | unknown | [doc](features/commands/fragment.md) |
| `fuse` `fuse(selection1='(pk1)', selection2='(pk2)', mode=0, recolor=1, move=1)` | command | Joins two objects into one by forming a bond, moving/merging a copy of the first into the second. | implemented | [doc](features/topics/editing-building.md#fuse) |
| `get_editor_scheme` `get_editor_scheme()` | command | Returns the current builder/editor scheme mode as an integer code. | unknown | [doc](features/commands/get_editor_scheme.md) |
| `h_add` `h_add(selection='(all)', quiet=1, state=0, legacy=0)` | command | Adds hydrogens onto a molecule based on current heavy-atom valences (fills all open valences). | implemented | [doc](features/topics/editing-building.md#h_add) |
| `h_fill` `h_fill(quiet=1)` | command | Removes and replaces the hydrogens on the atom or bond picked for editing. | implemented | [doc](features/topics/editing-building.md#h_fill) |
| `h_fix` `h_fix(selection='', quiet=1)` | command | Repositions existing hydrogen atoms (unsupported/legacy); used to fix backbone/amide H geometry. | partial | [doc](features/topics/editing-building.md#h_fix) |
| `invert` `invert(quiet=1)` | command | Inverts the stereochemistry at the picked atom, holding two attached atoms fixed. | implemented | [doc](features/commands/invert.md) |
| `load_coords` `load_coords(coords, selection, state=1, quiet=1)` | command | API-only loader that writes an Nx3 coordinate array into a selection's atoms in atom-sorted order. | implemented | [doc](features/commands/load_coords.md) |
| `load_coordset` `load_coordset(coords, object, state=0, quiet=1)` | command | API-only loader that writes an Nx3 coordinate array into an object in original file atom order, appending a state when state=0. | implemented | [doc](features/commands/load_coordset.md) |
| `mask` `mask(selection='(all)', quiet=1)` | command | Makes atoms impossible to select with the mouse without affecting command-line selection or transforms. | implemented | [doc](features/topics/editing-building.md#mask) |
| `mse2met` `mse2met(selection='all', quiet=1)` | command | Mutates selenomethionine (MSE) residues to methionine (MET). | implemented | [doc](features/commands/mse2met.md) |
| `protect` `protect(selection='(all)', quiet=1)` | command | Protects atoms from transformations performed by the editing features (torsion, drag, sculpt). | implemented | [doc](features/topics/editing-building.md#protect) |
| `protonate` `protonate(selection='all', pH=7.4, ff='amber', state=0, quiet=1)` | command | Adds hydrogens with pH-dependent protonation states (PROPKA or textbook pKa), unlike h_add. | implemented | [doc](features/topics/editing-building.md#protonate) |
| `pseudoatom` `pseudoatom(object='', selection='', name='PS1', resn='PSD', resi='1', chain='P', segi='PSDO', elem='PS', vdw=-1.0, hetatm=1, b=0.0, q=0.0, color='', label='', pos=None, state=0, mode='rms', quiet=1)` | command | Adds a placeholder/marker pseudoatom to a molecular object, creating the object if needed. | implemented | [doc](features/topics/editing-building.md#pseudoatom) |
| `push_undo` `push_undo(selection, just_coordinates=1, finish_undo=0, add_objects=0, delete_objects=0, state=0)` | command | Pushes the current object conformations onto their per-object undo rings. | implemented | [doc](features/commands/push_undo.md) |
| `rebond` `rebond(oname, state=-1, pbc=1)` | command | Discards all bonds in an object and recomputes them by interatomic distance. | implemented | [doc](features/topics/editing-building.md#rebond) |
| `redo` `redo()` | command | Reapply the last undone conformational change to the object being edited. | implemented | [doc](features/commands/redo.md) |
| `reference` `reference(action='validate', selection='(all)', state=0, quiet=1)` | command | Manage a per-atom reference state (validate/store/recall/swap) for a selection. | unknown | [doc](features/commands/reference.md) |
| `remove` `remove(selection, quiet=1)` | command | Eliminates the atoms in a selection from their molecular objects (keeps the object). | implemented | [doc](features/topics/editing-building.md#remove) |
| `remove_picked` `remove_picked(hydrogens=1, quiet=1)` | command | Removes the atom or bond currently picked for editing, optionally with attached hydrogens. | implemented | [doc](features/commands/remove_picked.md) |
| `rename` `rename(selection='all', force=0, quiet=1)` | command | Generates atom names that are unique within each residue of a selection. | planned | [doc](features/commands/rename.md) |
| `replace` `replace(element, geometry, valence, h_fill=1, name='', quiet=1)` | command | Replaces the currently picked atom with a new atom of a given element, geometry, and valence. | implemented | [doc](features/commands/replace.md) |
| `rotate` `rotate(axis='x', angle=0.0, selection='all', state=-1, camera=1, object=None, origin=None, object_mode=0)` | command | Rotates atom coordinates in a selection about an axis, or modifies an object/state matrix. | implemented | [doc](features/commands/rotate.md) |
| `set_dihedral` `set_dihedral(atom1, atom2, atom3, atom4, angle, state=1, quiet=1)` | command | Sets the dihedral angle defined by four bonded, acyclic atoms by rotating about the central bond. | implemented | [doc](features/commands/set_dihedral.md) |
| `set_geometry` `set_geometry(selection, geometry, valence)` | command | Changes PyMOL's assumed valence/geometry (hybridization) of atoms so H-filling and bonding behave. | implemented | [doc](features/topics/editing-building.md#set_geometry) |
| `smooth` `smooth(selection='all', passes=1, window=5, first=1, last=0, ends=0, quiet=1, cutoff=-1, pbc=1)` | command | Applies a moving-window average across coordinate states to damp high-frequency motion in a trajectory. | implemented | [doc](features/commands/smooth.md) |
| `sort` `sort(object='')` | command | Reorders atoms within objects into canonical order, typically after alter has changed naming properties. | implemented | [doc](features/commands/sort.md) |
| `torsion` `torsion(angle)` | command | Rotates the torsion about the currently picked bond by a delta angle. | implemented | [doc](features/topics/editing-building.md#torsion) |
| `transform_object` `transform_object(name, matrix, state=-1, log=0, selection='', homogenous=0, transpose=0)` | command | API-only function that applies a 4x4 transformation matrix to an object (or its TTT matrix). | implemented | [doc](features/commands/transform_object.md) |
| `transform_selection` `transform_selection(selection, matrix, state=-1, log=0, homogenous=0, transpose=0)` | command | Applies a 4x4 transformation matrix to the atomic coordinates of a selection. | implemented | [doc](features/commands/transform_selection.md) |
| `translate` `translate(vector=[0.0, 0.0, 0.0], selection='all', state=-1, camera=1, object=None, object_mode=0)` | command | Translates the atomic coordinates of a selection, or modifies an object's display/TTT matrix. | implemented | [doc](features/commands/translate.md) |
| `translate_atom` `translate_atom(sele1, v0, v1, v2, state=0, mode=0, log=0)` | command | Translates a single picked atom by a vector; the primitive behind interactive atom dragging. | implemented | [doc](features/topics/editing-building.md#translate_atom) |
| `unbond` `unbond(atom1='(pk1)', atom2='(pk2)', quiet=1)` | command | Removes all bonds between two atom selections. | implemented | [doc](features/commands/unbond.md) |
| `undo` `undo()` | command | Restores the previous conformation of the object currently being edited. | implemented | [doc](features/commands/undo.md) |
| `uniquify` `uniquify(identifier, selection, reference='', quiet=1)` | command | Renames an atom identifier so its values are unique relative to a reference selection. | implemented | [doc](features/commands/uniquify.md) |
| `unpick` `unpick()` | command | Deletes the pk1, pk2, ... editor selections used for atom picking and molecular editing. | partial | [doc](features/topics/editing-building.md#unpick) |
| `update` `update(target, source, target_state=0, source_state=0, matchmaker=1, quiet=1)` | command | Transfers coordinates from a source selection onto a target selection. | implemented | [doc](features/commands/update.md) |
| `valence` `valence(order, selection1=None, selection2=None, source='', target_state=0, source_state=0, reset=1, quiet=1, symop='')` | command | Sets the bond order of all bonds between two selections (single/double/triple/aromatic/guess/copy). | implemented | [doc](features/topics/editing-building.md#valence) |
| `vdw_fit` `vdw_fit(selection1, selection2, state1=1, state2=1, buffer=0.24, quiet=1)` | command | Unsupported/experimental feature that fits van der Waals radii between two selections. | partial | [doc](features/commands/vdw_fit.md) |
| `Builder panel` | feature | The dockable GUI over the editing surface with Chemical/Protein/Nucleic Acid tabs and three action rows, every button issuing cmd.* calls. | implemented | [doc](features/topics/editing-building.md#the-builder-panel) |
| `join` | feature | Not a PyMOL command; joining molecular objects is done with fuse (bond+merge) or create/combine. | unknown | [doc](features/topics/editing-building.md#join) |
| `sculpt controls` | feature | The Builder's Sculpt/Clean/Fix/Rest group: real-time geometry relaxation with atom pinning and restraint flags. | implemented | [doc](features/topics/editing-building.md#sculpting-controls) |
| `pk1/pk2/pk3/pk4` | selection | The four reserved, click-ordered editor selections that are the implicit default arguments of nearly every editing command. | implemented | [doc](features/topics/editing-building.md#the-pk1-pk4-editor-selections) |

## file-io (36)

| Feature | Kind | Summary | Parity | Doc |
| --- | --- | --- | --- | --- |
| `@` `@<filename>` | command | The @file.pml directive that inline-includes and executes a PyMOL command script. | implemented | [doc](features/topics/file-formats.md#-command-script-include) |
| `accept` `accept()` | command | Internal handler that approves potentially unsafe content in a loading session file. | implemented | [doc](features/commands/accept.md) |
| `as_pathstr` `as_pathstr(path)` | command | Internal helper that normalises a filesystem path to a platform-appropriate string. | internal | [doc](features/commands/as_pathstr.md) |
| `download_chem_comp` `download_chem_comp(resn, quiet=1)` | command | Internal routine that downloads the RCSB chemical-component CIF for a residue name and returns its local path. | internal | [doc](features/commands/download_chem_comp.md) |
| `fetch` `fetch(code, name='', state=0, finish=1, discrete=-1, multiplex=-2, zoom=-1, type='', async_=0, path='', file=None, quiet=1)` | command | Download a structure, map or chemical component by accession code from PDB/PDBe/PDBj/EMDB/PubChem/CCD and load it. | implemented | [doc](features/topics/file-formats.md#fetch) |
| `file_read` `file_read(finfo)` | command | Internal helper that reads a file (optionally gzip/bzip2 compressed) and returns its contents. | internal | [doc](features/commands/file_read.md) |
| `filename_to_objectname` `filename_to_objectname(fname)` | command | Internal helper that derives a legal PyMOL object name from a filesystem path. | internal | [doc](features/commands/filename_to_objectname.md) |
| `finish_object` `finish_object(name)` | command | Finalizes an object's processing after states were loaded with the finish flag disabled, for efficient bulk multi-state loading. | implemented | [doc](features/commands/finish_object.md) |
| `get_bytes` `get_bytes(format, selection='(all)', state=-1, ref='', ref_state=-1, multi=-1, quiet=1)` | command | Exports a selection to a molecular file format and returns it as a bytes string. | implemented | [doc](features/commands/get_bytes.md) |
| `get_cifstr` `get_cifstr(selection='all', state=-1, quiet=1)` | command | API-only: return an mmCIF string for a selection/state. | implemented | [doc](features/topics/file-formats.md#get_cifstr) |
| `get_fastastr` `get_fastastr(selection='all', state=-1, quiet=1, key='')` | command | Returns protein and nucleic-acid sequences for a selection in FASTA format. | implemented | [doc](features/commands/get_fastastr.md) |
| `get_model` `get_model(selection='(all)', state=1, ref='', ref_state=0)` | command | API-only: return a ChemPy Indexed model (atoms, bonds, coords) for a selection. | implemented | [doc](features/topics/file-formats.md#get_model) |
| `get_pdbstr` `get_pdbstr(selection='all', state=-1, ref='', ref_state=-1, quiet=1)` | command | Return a PDB-format string for the atoms in a selection at a given state. | implemented | [doc](features/commands/get_pdbstr.md) |
| `get_session` `get_session(names='', partial=0, quiet=1, compress=-1, cache=-1, binary=-1, version=-1)` | command | Build the in-memory PSE session dictionary for some or all objects, honouring version/binary/cache settings. | implemented | [doc](features/commands/get_session.md) |
| `get_str` `get_str(format, selection='(all)', state=-1, ref='', ref_state=-1, multi=-1, quiet=1)` | command | Export a selection to a molecular file format and return it as a unicode string. | implemented | [doc](features/commands/get_str.md) |
| `load` `load(filename, object='', state=0, format='', finish=1, discrete=-1, quiet=1, multiplex=None, zoom=-1, partial=0, mimic=1, object_props=None, atom_props=None)` | command | Universal reader for molecules, maps, sessions and other content, with format guessed from the file extension. | implemented | [doc](features/topics/file-formats.md#load) |
| `load_brick` `load_brick(*arg, **kw)` | command | Load a volumetric brick object (temporary routine for the GAMESS-UK project). | unknown | [doc](features/commands/load_brick.md) |
| `load_callback` `load_callback(*arg)` | command | Load a generic Python callback object that fires on every screen update (e.g. for custom OpenGL). | unknown | [doc](features/commands/load_callback.md) |
| `load_embedded` `load_embedded(key=None, name=None, state=0, finish=1, discrete=1, quiet=1, zoom=-1, multiplex=-2, object_props=None, atom_props=None)` | command | Load structure/data blocks that were embedded inline in the current script with the embed command. | partial | [doc](features/commands/load_embedded.md) |
| `load_model` `load_model(model, object, state=0, finish=1, discrete=0)` | command | Load a ChemPy model object into a new PyMOL object (inverse of get_model). | implemented | [doc](features/topics/file-formats.md#load_model) |
| `load_object` `load_object(type, object, name, state=0, finish=1, discrete=0, quiet=1, zoom=-1)` | command | General developer entry point that loads a Python object of a given numeric loadable type into PyMOL. | unknown | [doc](features/commands/load_object.md) |
| `load_raw` `load_raw(content, format, object='', state=0, finish=1, discrete=-1, quiet=1, multiplex=None, zoom=-1)` | command | API-only loader for content already in memory, using a temp file only when the format lacks a string loadable. | implemented | [doc](features/topics/file-formats.md#load_raw) |
| `loadall` `loadall(pattern, group='', quiet=1)` | command | Load every file matching a filesystem glob pattern, optionally grouping the resulting objects. | partial | [doc](features/commands/loadall.md) |
| `multifilenamegen` `multifilenamegen(filename, selection, state)` | command | Expand a placeholder filename template into the concrete (filename, selection, state) triples multifilesave would write. | implemented | [doc](features/topics/file-formats.md#multifilenamegen) |
| `multifilesave` `multifilesave(filename, selection='*', state=-1, format='', ref='', ref_state=-1, quiet=1)` | command | Save each object/state of a selection to a separate placeholder-templated file. | implemented | [doc](features/topics/file-formats.md#multifilesave) |
| `multisave` `multisave(filename, pattern='all', state=-1, append=0, format='', quiet=1)` | command | Write a multi-entry PDB/CIF file with a HEADER/CRYST block per object so it reloads as separate objects. | implemented | [doc](features/topics/file-formats.md#multisave) |
| `read_mmodstr` `read_mmodstr(content, name, state=0, quiet=1, zoom=-1)` | command | Load a MacroModel-format structure from an in-memory Python string, no temp file. | unknown | [doc](features/commands/read_mmodstr.md) |
| `read_molstr` `read_molstr(molstr, name, state=0, finish=1, discrete=1, quiet=1, zoom=-1)` | command | Load an MDL MOL format structure from an in-memory Python string. | implemented | [doc](features/commands/read_molstr.md) |
| `read_pdbstr` `read_pdbstr(contents, oname, state=0, finish=1, discrete=0, quiet=1, zoom=-1, multiplex=-2, object_props=None)` | command | Load or update a structure from a PDB-format Python string, no temp file. | unknown | [doc](features/commands/read_pdbstr.md) |
| `read_sdfstr` `read_sdfstr(sdfstr, name, state=0, finish=1, discrete=1, quiet=1, zoom=-1, multiplex=-2, object_props=None)` | command | Load an MDL SD/MOL format structure from an in-memory Python string. | implemented | [doc](features/commands/read_sdfstr.md) |
| `run` `run(filename, namespace=None)` | command | Execute a Python or PyMOL-command script file in the running instance. | implemented | [doc](features/topics/file-formats.md#run) |
| `save` `save(filename, selection='(all)', state=-1, format='', ref='', ref_state=-1, quiet=1, partial=0)` | command | Universal writer for selections, sessions, maps, alignments, images and geometry, format chosen by extension. | implemented | [doc](features/topics/file-formats.md#save) |
| `set_session` `set_session(session, partial=0, quiet=1, cache=1, steal=-1)` | command | Restore a session dictionary (or its zlib+pickle bytes) into the current instance, triggering the security wizard on embedded movie commands. | implemented | [doc](features/topics/file-formats.md#set_session) |
| `session-format` | feature | PyMOL's native .pse/.psw pickled-session format, including PNG thumbnail embedding and .psw presentation auto-start. | implemented | [doc](features/topics/file-formats.md#session-format-pse--psw) |
| `supported-formats` | feature | The complete set of molecular, map, session, image and geometry formats PyMOL can read and/or write, dispatched by filename extension. | implemented | [doc](features/topics/file-formats.md#supported-formats-the-master-table) |
| `fetch_path` | setting | Directory where fetch and download_chem_comp cache downloaded files. | implemented | [doc](features/topics/file-formats.md#fetch_path) |

## fitting-alignment (18)

| Feature | Kind | Summary | Parity | Doc |
| --- | --- | --- | --- | --- |
| `align` `align(mobile, target, cutoff=2.0, cycles=5, gap=-10.0, extend=-0.5, max_gap=50, object=None, matrix='BLOSUM62', mobile_state=0, target_state=0, quiet=1, max_skip=0, transform=1, reset=0)` | command | Sequence-alignment-driven structural superposition with outlier-rejection cycles; best for proteins with >30% identity. | implemented | [doc](features/topics/fitting-alignment.md#align) |
| `alignto` `alignto(target='', method='cealign', selection='', quiet=1, **kwargs)` | command | Aligns all other loaded objects onto a target object using a chosen method (wrapper over extra_fit; defaults to cealign). | implemented | [doc](features/topics/fitting-alignment.md#alignto) |
| `cealign` `cealign(target, mobile, target_state=1, mobile_state=1, quiet=1, guide=1, d0=3.0, d1=4.0, window=8, gap_max=30, transform=1, object=None)` | command | CE (Combinatorial Extension) pure-structure aligner needing no sequence similarity; target is the first argument. | implemented | [doc](features/topics/fitting-alignment.md#cealign) |
| `extra_fit` `extra_fit(selection='(all)', reference='', method='align', zoom=1, quiet=0, **kwargs)` | command | Fits every object in a selection onto a reference object using a chosen alignment method (multi-object analogue of intra_fit). | implemented | [doc](features/topics/fitting-alignment.md#extra_fit) |
| `fit` `fit(mobile, target, mobile_state=0, target_state=0, quiet=1, matchmaker=0, cutoff=2.0, cycles=0, object=None)` | command | Superimposes one selection onto another using only atoms that match by identifier, with optional outlier-rejection refinement. | implemented | [doc](features/commands/fit.md) |
| `get_raw_alignment` `get_raw_alignment(name='', active_only=0)` | command | Returns the per-atom alignment relationships of an alignment object as a list of columns of (object, index) tuples. | partial | [doc](features/topics/fitting-alignment.md#get_raw_alignment) |
| `intra_fit` `intra_fit(selection, state=1, quiet=1, mix=0, pbc=1)` | command | Fits all states of an object onto a reference state and moves them; returns the per-state RMS array. | implemented | [doc](features/topics/fitting-alignment.md#intra_fit) |
| `intra_rms` `intra_rms(selection, state=0, quiet=1)` | command | Computes best-fit RMS for all states of an object relative to a reference state, leaving coordinates unchanged. | implemented | [doc](features/topics/fitting-alignment.md#intra_rms) |
| `intra_rms_cur` `intra_rms_cur(selection, state=0, quiet=1)` | command | Computes RMS for all states of an object relative to a reference state with no fitting (state analogue of rms_cur). | unknown | [doc](features/topics/fitting-alignment.md#intra_rms_cur) |
| `matrix_copy` `matrix_copy(source_name='', target_name='', source_mode=-1, target_mode=-1, source_state=1, target_state=1, target_undo=1, log=0, quiet=1)` | command | Copies an object's transformation matrix onto another object (or into the camera view). | partial | [doc](features/commands/matrix_copy.md) |
| `matrix_reset` `matrix_reset(name, state=1, mode=-1, log=0, quiet=1)` | command | Resets an object's transformation matrix (representation, TTT/movie, or state matrix). | unknown | [doc](features/commands/matrix_reset.md) |
| `matrix_transfer` `matrix_transfer(source_name='', target_name='', source_mode=-1, target_mode=-1, source_state=1, target_state=1, target_undo=1, log=0, quiet=1)` | command | Legacy alias of matrix_copy that copies a transformation matrix from one object to another. | unknown | [doc](features/commands/matrix_transfer.md) |
| `pair_fit` `pair_fit(*arg, quiet=0)` | command | Superposes explicitly matched sets of atom pairs (mobile/target selections listed two-by-two) and moves the mobile object. | implemented | [doc](features/topics/fitting-alignment.md#pair_fit) |
| `rms` `rms(mobile, target, mobile_state=0, target_state=0, quiet=1, matchmaker=0, cutoff=2.0, cycles=0, object=None)` | command | Computes the RMS fit between two atom selections without transforming the models. | implemented | [doc](features/commands/rms.md) |
| `rms_cur` `rms_cur(mobile, target, mobile_state=0, target_state=0, quiet=1, matchmaker=0, cutoff=2.0, cycles=0, object=None)` | command | Computes the RMS difference between two selections as they currently sit, with no fitting. | implemented | [doc](features/topics/fitting-alignment.md#rms_cur) |
| `set_raw_alignment` `set_raw_alignment(name, raw, guide='', state=1, quiet=1)` | command | API-only command that builds an alignment object from explicit lists of (model, index) atom-pair columns. | implemented | [doc](features/topics/fitting-alignment.md#set_raw_alignment) |
| `super` `super(mobile, target, cutoff=2.0, cycles=5, gap=-1.5, extend=-0.7, max_gap=50, object=None, matrix='BLOSUM62', mobile_state=0, target_state=0, quiet=1, max_skip=0, transform=1, reset=0, seq=0.0, radius=12.0, scale=17.0, base=0.65, coord=0.0, expect=6.0, window=3, ante=-1.0)` | command | Residue-based structural superposition weighting sequence, secondary/tertiary structure and coordinates; robust at low sequence identity. | implemented | [doc](features/topics/fitting-alignment.md#super) |
| `usalign` `usalign(mobile, target, mobile_state=1, target_state=1, quiet=1, transform=1, object=None, fast=0)` | command | TM-align/USalign TM-score-optimised, length-independent superposition using only guide atoms (Cα / C4'). | implemented | [doc](features/topics/fitting-alignment.md#usalign) |

## internal (28)

| Feature | Kind | Summary | Parity | Doc |
| --- | --- | --- | --- | --- |
| `contour_sc` `contour_sc(sc, gnot)` | command | Internal shortcut-completion helper for contour-related argument names. | internal | [doc](features/commands/contour_sc.md) |
| `dirty` `dirty()` | command | Marks the scene as needing a redraw/rebuild; a low-level (largely obsolete) refresh hint. | implemented | [doc](features/commands/dirty.md) |
| `get_bond_print` `get_bond_print(obj, max_bond, max_type)` | command | Experimental/debug helper that dumps internal bond-print information for an object. | unknown | [doc](features/commands/get_bond_print.md) |
| `get_modal_draw` `get_modal_draw(quiet=1)` | command | Returns whether a modal (multi-pass) draw is pending in the render loop. | internal | [doc](features/commands/get_modal_draw.md) |
| `is_dict` `is_dict(obj)` | command | Return True if the given object is a Python dict. | internal | [doc](features/commands/is_dict.md) |
| `is_error` `is_error(result)` | command | Return True if a command result code represents an error (a negative integer). | internal | [doc](features/commands/is_error.md) |
| `is_gui_thread` `is_gui_thread()` | command | Return True if the caller runs on the GUI thread (or there is no GUI thread). | internal | [doc](features/commands/is_gui_thread.md) |
| `is_list` `is_list(obj)` | command | Return True if the given object is a Python list. | internal | [doc](features/commands/is_list.md) |
| `is_ok` `is_ok(result)` | command | Return True if a command result code does not represent an error. | internal | [doc](features/commands/is_ok.md) |
| `is_sequence` `is_sequence(obj)` | command | Return True if the given object is a list or a tuple. | internal | [doc](features/commands/is_sequence.md) |
| `is_string` `is_string(obj)` | command | Return True if the given object is a string (str or bytes). | internal | [doc](features/commands/is_string.md) |
| `is_tuple` `is_tuple(obj)` | command | Return True if the given object is a Python tuple. | internal | [doc](features/commands/is_tuple.md) |
| `loadable` | command | Namespace class mapping human-readable format names to the numeric type codes used by load_object. | internal | [doc](features/commands/loadable.md) |
| `lock` `lock()` | command | Internal helper that acquires PyMOL's API lock to serialise access to the C layer. | internal | [doc](features/commands/lock.md) |
| `lock_attempt` `lock_attempt()` | command | Internal non-blocking helper that tries to acquire PyMOL's API lock and returns immediately. | internal | [doc](features/commands/lock_attempt.md) |
| `lock_without_glut` `lock_without_glut()` | command | Internal helper that acquires the API lock while already holding the GLUT/GUI lock, avoiding deadlock. | internal | [doc](features/commands/lock_without_glut.md) |
| `map_sc` `map_sc(sc=Shortcut, gnot=get_names_of_type)` | command | Internal shortcut factory supplying tab-completion candidates for map object names. | internal | [doc](features/commands/map_sc.md) |
| `mem` `mem()` | command | Dumps the current internal memory state to standard output for debugging. | implemented | [doc](features/commands/mem.md) |
| `meter_reset` `meter_reset()` | command | Resets the frames-per-second (rate) counter. | planned | [doc](features/commands/meter_reset.md) |
| `object_sc` `object_sc(sc=Shortcut, gn=get_names)` | command | Internal helper that builds a Shortcut of current object names for tab-completion. | internal | [doc](features/commands/object_sc.md) |
| `paste` `paste()` | command | Internal command that pastes text from the system clipboard into PyMOL. | internal | [doc](features/commands/paste.md) |
| `ready` `ready()` | command | Internal predicate reporting whether the PyMOL engine has finished initializing. | internal | [doc](features/commands/ready.md) |
| `safe_alpha_list_eval` `safe_alpha_list_eval(st)` | command | Safely evaluates a string like safe_eval but first strips most non-alphanumeric characters. | internal | [doc](features/commands/safe_alpha_list_eval.md) |
| `safe_eval` `safe_eval(st)` | command | A sandboxed eval that evaluates bare names to strings and blocks harmful code. | internal | [doc](features/commands/safe_eval.md) |
| `safe_list_eval` `safe_list_eval(st)` | command | Alias of safe_eval used to parse list/tuple literals safely into Python values. | internal | [doc](features/commands/safe_list_eval.md) |
| `selection_sc` `selection_sc(sc=<Shortcut>, gn=<get_names>)` | command | Internal helper that builds a Shortcut over object names and selection keywords for tab-completion. | internal | [doc](features/commands/selection_sc.md) |
| `test` `test(group=0, index=0)` | command | Unsupported internal development/test routine that dispatches to a C-core test entry point. | internal | [doc](features/commands/test.md) |
| `unlock` `unlock(result=None)` | command | Internal helper that releases the API lock and flushes the command queue. | internal | [doc](features/commands/unlock.md) |

## labeling (3)

| Feature | Kind | Summary | Parity | Doc |
| --- | --- | --- | --- | --- |
| `callout` `callout(name, label, pos='', screen='auto', state=-1, color='front', quiet=1)` | command | Creates a screen-stabilized callout (labeled arrow) object. | planned | [doc](features/commands/callout.md) |
| `label` `label(selection='(all)', expression='', quiet=1)` | command | Label atoms in a selection by evaluating a per-atom Python expression that yields a string. | implemented | [doc](features/commands/label.md) |
| `label2` `label2(selection='(all)', expression='', quiet=1)` | command | Variant of label that evaluates a per-atom expression to set atom labels via the label2 path. | implemented | [doc](features/commands/label2.md) |

## maps-volumes (26)

| Feature | Kind | Summary | Parity | Doc |
| --- | --- | --- | --- | --- |
| `get_volume_field` `get_volume_field(objName, state=1, copy=1)` | command | API-only accessor returning the raw scalar grid of a map or volume object. | implemented | [doc](features/topics/maps-volumes.md#get_volume_field) |
| `get_volume_histogram` `get_volume_histogram(objName, bins=64, range=None)` | command | API-only: returns [min, max, mean, stdev, histogram...] (length bins+4) for a map or volume. | implemented | [doc](features/topics/maps-volumes.md#get_volume_histogram) |
| `gradient` `gradient(name, map, minimum=1.0, maximum=-1.0, selection='', buffer=0.0, state=0, carve=None, source_state=0, quiet=1)` | command | Creates a gradient object from a map between a minimum and maximum level. | implemented | [doc](features/topics/maps-volumes.md#gradient) |
| `isodot` `isodot(name, map, level=1.0, selection='', buffer=0.0, state=0, carve=None, source_state=0, quiet=1)` | command | Creates a dot isosurface object (sampled points) from a map at a contour level. | implemented | [doc](features/topics/maps-volumes.md#isodot) |
| `isolevel` `isolevel(name, level=1.0, state=0, query=0, quiet=1)` | command | Change (or query) the contour level of an existing isodot, isomesh, or isosurface object. | implemented | [doc](features/commands/isolevel.md) |
| `isomesh` `isomesh(name, map, level=1.0, selection='', buffer=0.0, state=1, carve=None, source_state=0, quiet=1)` | command | Create a mesh (wireframe) isosurface object from a map object at a given contour level. | implemented | [doc](features/commands/isomesh.md) |
| `isosurface` `isosurface(name, map, level=1.0, selection='', buffer=0.0, state=1, carve=None, source_state=0, side=1, mode=3, quiet=1)` | command | Create a solid triangulated surface object from a map object at a given contour level. | implemented | [doc](features/commands/isosurface.md) |
| `load_map` `load_map(object, name, state, finish, discrete)` | command | Developer helper that loads a ChemPy map object into PyMOL (temporary routine for the Phenix project). | unknown | [doc](features/commands/load_map.md) |
| `load_mtz` `load_mtz(filename, prefix='', amplitudes='', phases='', weights='None', reso_low=0, reso_high=0, quiet=1)` | command | Load an MTZ reflection file as map object(s); raises IncentiveOnlyException in this open-source build. | partial | [doc](features/commands/load_mtz.md) |
| `map_double` `map_double(name, state=0)` | command | Resamples a map at twice the current resolution (eight-fold memory increase). | implemented | [doc](features/topics/maps-volumes.md#map_double) |
| `map_generate` `map_generate(name, reflection_file, amplitudes, phases, weights='None', reso_low=50.0, reso_high=1.0, quiet=1, zoom=1)` | command | Synthesizes an x-ray map object from a reflection (MTZ) file and amplitude/phase columns. | implemented | [doc](features/topics/maps-volumes.md#map_generate) |
| `map_halve` `map_halve(name, state=0, smooth=1)` | command | Resamples a map object at half its current resolution (coarser grid), optionally smoothing. | implemented | [doc](features/commands/map_halve.md) |
| `map_new` `map_new(name, type='gaussian', grid=None, selection='(all)', buffer=None, box=None, state=0, quiet=1, zoom=0, normalize=-1, clamp=[1.0, -1.0], resolution=0.0)` | command | Creates a map object with a built-in generator (Gaussian, VDW, Coulomb, etc.) over a selection. | implemented | [doc](features/commands/map_new.md) |
| `map_set` `map_set(name, operator, operands='', target_state=0, source_state=0, zoom=0, quiet=1)` | command | Performs elementwise operations on and between map objects (min, max, sum, average, difference, copy, unique). | partial | [doc](features/commands/map_set.md) |
| `map_set_border` `map_set_border(name, level=0.0, state=0)` | command | Sets the map value on all edge (border) grid points to a fixed level. | implemented | [doc](features/commands/map_set_border.md) |
| `map_trim` `map_trim(name, selection, buffer=0.0, map_state=0, sele_state=0, quiet=1)` | command | Reduces a map's extent to just cover a selection of atoms plus a buffer. | implemented | [doc](features/commands/map_trim.md) |
| `read_xplorstr` `read_xplorstr(xplor, name, state=0, finish=1, discrete=0, quiet=1, zoom=-1)` | command | Load an XPLOR map from an in-memory Python string, bypassing temp files. | unknown | [doc](features/commands/read_xplorstr.md) |
| `slice_new` `slice_new(name, map, state=1, source_state=0)` | command | Creates a 2-D slice (cutting plane) object through a map, colored by a ramp. | unknown | [doc](features/topics/maps-volumes.md#slice_new) |
| `volume` `volume(name, map, ramp='', selection='', buffer=0.0, state=1, carve=None, source_state=0, quiet=1)` | command | Creates a direct volume-rendering object from a map, colored by a named ramp transfer function. | unknown | [doc](features/topics/maps-volumes.md#volume) |
| `volume_color` `volume_color(name, ramp='', state=-1, quiet=1, _guiupdate=True)` | command | Sets or gets the value-to-RGBA transfer function (color ramp) of a volume object. | implemented | [doc](features/topics/maps-volumes.md#volume_color) |
| `volume_panel` `volume_panel(name, quiet=1, _noqt=0)` | command | Opens an interactive GUI panel for editing a volume object's color ramp. | partial | [doc](features/commands/volume_panel.md) |
| `volume_ramp_new` `volume_ramp_new(name, ramp)` | command | Registers a named volume color ramp reusable as a preset when creating or coloring volumes. | implemented | [doc](features/commands/volume_ramp_new.md) |
| `CCP4` | feature | CCP4/MRC binary electron-density raster format loaded via cmd.load (format='ccp4'); also brix/dsn6/omap. | partial | [doc](features/topics/maps-volumes.md#ccp4) |
| `DX` | feature | OpenDX/APBS electrostatics grid format (.dx/.dxbin) loaded via cmd.load (format='dx'). | partial | [doc](features/topics/maps-volumes.md#dx) |
| `Volume Color Map Editor` | feature | Interactive panel editing a volume's transfer function: map histogram plot with draggable color/alpha control points on a logarithmic alpha axis. | implemented | [doc](features/topics/maps-volumes.md#volume-color-map-editor) |
| `XPLOR` | feature | XPLOR/CNS ASCII density map format loaded via cmd.load or the API-only read_xplorstr. | implemented | [doc](features/topics/maps-volumes.md#xplor) |

## measurement (10)

| Feature | Kind | Summary | Parity | Doc |
| --- | --- | --- | --- | --- |
| `angle` `angle(name=None, selection1='(pk1)', selection2='(pk2)', selection3='(pk3)', mode=None, label=1, reset=0, zoom=0, state=0, quiet=1, state1=-3, state2=-3, state3=-3)` | command | Creates a measurement object showing the angle formed between three atoms. | implemented | [doc](features/commands/angle.md) |
| `auto_measure` `auto_measure()` | command | Automatically creates a distance, angle, or dihedral from the currently picked atoms. | unknown | [doc](features/commands/auto_measure.md) |
| `dihedral` `dihedral(name=None, selection1='(pk1)', selection2='(pk2)', selection3='(pk3)', selection4='(pk4)', mode=None, label=1, reset=0, zoom=0, state=0, quiet=1)` | command | Creates a measurement object showing the dihedral (torsion) angle formed between four atoms. | implemented | [doc](features/commands/dihedral.md) |
| `dist` `dist(name=None, selection1='(pk1)', selection2='(pk2)', cutoff=None, mode=None, zoom=0, width=None, length=None, gap=None, label=1, quiet=1, reset=0, state=0, state1=-3, state2=-3)` | command | Alias for `distance` — creates a distance-measurement object between two selections. | implemented | [doc](features/commands/dist.md) |
| `distance` `distance(name=None, selection1='(pk1)', selection2='(pk2)', cutoff=None, mode=None, zoom=0, width=None, length=None, gap=None, label=1, quiet=1, reset=0, state=0, state1=-3, state2=-3)` | command | Creates a named distance-measurement object between two atom selections, with several interaction modes. | implemented | [doc](features/commands/distance.md) |
| `get_dihedral` `get_dihedral(atom1='pk1', atom2='pk2', atom3='pk3', atom4='pk4', state=-1, quiet=1)` | command | Returns the dihedral (torsion) angle in degrees between four atoms. | implemented | [doc](features/commands/get_dihedral.md) |
| `get_extent` `get_extent(selection='(all)', state=0, quiet=1)` | command | Returns the min and max XYZ coordinates (bounding box) of a selection. | implemented | [doc](features/commands/get_extent.md) |
| `get_sasa_relative` `get_sasa_relative(selection='all', state=1, vis=-1, var='b', quiet=1, outfile='', *, subsele='all')` | command | Compute relative per-residue solvent-accessible surface area, loading 0.0-1.0 exposure into the b-factor. | implemented | [doc](features/commands/get_sasa_relative.md) |
| `overlap` `overlap(selection1, selection2, state1=1, state2=1, adjust=0.0, quiet=1)` | command | Sums pairwise VDW-minus-distance overlap between two atom selections. | implemented | [doc](features/commands/overlap.md) |
| `pi_interactions` `pi_interactions(name='', selection1='all', selection2='same', state=0, state1=-3, state2=-3, quiet=1, reset=0)` | command | Finds pi-pi and pi-cation interactions (incentive-only in upstream PyMOL). | partial | [doc](features/commands/pi_interactions.md) |

## movies-scenes-states (58)

| Feature | Kind | Summary | Parity | Doc |
| --- | --- | --- | --- | --- |
| `backward` `backward()` | command | Steps the movie back one frame. | implemented | [doc](features/commands/backward.md) |
| `count_frames` `count_frames(quiet=1)` | command | Returns the number of frames defined for the PyMOL movie. | partial | [doc](features/commands/count_frames.md) |
| `count_states` `count_states(selection='(all)', quiet=1)` | command | Returns the number of coordinate states in a selection's object(s). | implemented | [doc](features/commands/count_states.md) |
| `delete_states` `delete_states(name, states)` | command | Deletes specified states (by number or range) from object(s). | implemented | [doc](features/commands/delete_states.md) |
| `ending` `ending()` | command | Jumps the movie to its last frame. | implemented | [doc](features/commands/ending.md) |
| `forward` `forward()` | command | Advances the movie one frame (relative + auto movie command). | implemented | [doc](features/topics/movies-scenes-states.md#forward) |
| `frame` `frame(frame, trigger=-1, scene=0)` | command | Sets the viewer to a specific movie frame, optionally running its command/scene. | implemented | [doc](features/topics/movies-scenes-states.md#frame) |
| `get_frame` `get_frame()` | command | Returns the current movie frame index (1-based), taking no lock. | partial | [doc](features/topics/movies-scenes-states.md#get_frame) |
| `get_movie_length` `get_movie_length(quiet=1, images=-1)` | command | Returns frames explicitly defined by mset, excluding implicit molecular states. | partial | [doc](features/topics/movies-scenes-states.md#get_movie_length) |
| `get_movie_locked` `get_movie_locked()` | command | Returns whether the movie is currently locked against playback/updates. | unknown | [doc](features/commands/get_movie_locked.md) |
| `get_movie_playing` `get_movie_playing()` | command | Returns a boolean indicating whether the movie is currently playing. | implemented | [doc](features/commands/get_movie_playing.md) |
| `get_scene_list` `get_scene_list()` | command | Return the ordered list of stored scene names. | partial | [doc](features/commands/get_scene_list.md) |
| `get_scene_message` `get_scene_message(name)` | command | Return the text message/annotation stored with a named scene. | unknown | [doc](features/commands/get_scene_message.md) |
| `get_scene_thumbnail` `get_scene_thumbnail(name)` | command | Return the stored thumbnail image data for a named scene. | unknown | [doc](features/commands/get_scene_thumbnail.md) |
| `get_state` `get_state()` | command | Returns the current object display state index (1-based), taking no lock. | implemented | [doc](features/topics/movies-scenes-states.md#get_state) |
| `get_title` `get_title(object, state, quiet=1)` | command | Retrieve the text title associated with a particular object state. | unknown | [doc](features/commands/get_title.md) |
| `join_states` `join_states(name, selection='all', mode=2, zoom=0, quiet=1)` | command | Build a multi-state object from a selection spanning several objects (reverse of split_states). | implemented | [doc](features/commands/join_states.md) |
| `load_traj` `load_traj(filename, object='', state=1, format='', interval=1, average=1, start=1, stop=-1, max=-1, selection='all', image=1, shift='[0.0,0.0,0.0]', plugin='')` | command | Read a molecular-dynamics trajectory file and append its frames as states of an existing object. | partial | [doc](features/commands/load_traj.md) |
| `madd` `madd(specification='', frame=0, freeze=0)` | command | Extends the existing movie frame-to-state specification using mset syntax. | implemented | [doc](features/commands/madd.md) |
| `mappend` `mappend(frame, command)` | command | Appends generalized command-line operations to a movie frame (additive counterpart of mdo). | implemented | [doc](features/commands/mappend.md) |
| `mclear` `mclear()` | command | Clears the cached rendered movie frame images. | implemented | [doc](features/topics/movies-scenes-states.md#mclear) |
| `mcopy` `mcopy(target, source=0, count=-1, freeze=0, object='', quiet=1)` | command | Copies key frames and movie commands from one range of the movie to another. | partial | [doc](features/commands/mcopy.md) |
| `mdelete` `mdelete(count=-1, frame=0, freeze=0, object='', quiet=1)` | command | Removes frames (camera views and object motions) from the movie timeline. | partial | [doc](features/commands/mdelete.md) |
| `mdo` `mdo(frame, command)` | command | Defines (or replaces) the command-line operations run when a given movie frame plays. | partial | [doc](features/commands/mdo.md) |
| `mdump` `mdump()` | command | Prints all defined movie commands to the feedback stream. | partial | [doc](features/topics/movies-scenes-states.md#mdump) |
| `middle` `middle()` | command | Jumps the movie playhead to the middle frame. | implemented | [doc](features/commands/middle.md) |
| `minsert` `minsert(count, frame=0, freeze=0, object='', quiet=1)` | command | Inserts blank frames into the movie's camera view and object motions. | planned | [doc](features/commands/minsert.md) |
| `mmatrix` `mmatrix(action)` | command | Stores, recalls, or clears the camera matrix used for the movie's first frame. | implemented | [doc](features/commands/mmatrix.md) |
| `mmove` `mmove(target, source=0, count=-1, freeze=0, object='', quiet=1)` | command | Moves key frames and movie commands from one frame position to another. | planned | [doc](features/commands/mmove.md) |
| `morph` `morph(name, sele1, sele2=None, state1=-1, state2=-1, refinement=3, steps=30, method='rigimol', match='align', quiet=1)` | command | Interpolated multi-state trajectory between conformations — incentive-only for BOTH rigimol and linear, so Open-Source PyMOL and the TS engine raise IncentiveOnlyException. | implemented | [doc](features/commands/morph.md) |
| `move_on_curve` `move_on_curve(mobile_obj, curve_obj, t)` | command | Positions an object along a named curve at a parametric point t. | implemented | [doc](features/commands/move_on_curve.md) |
| `movie.produce` `movie.produce(filename, mode='', first=0, last=0, preserve=0, encoder='', quality=-1, quiet=1, width=0, height=0)` | command | Encodes the movie to a video file (mp4/mov/webm/gif/mpg) autodetecting the encoder. | implemented | [doc](features/topics/movies-scenes-states.md#movie-produce) |
| `mplay` `mplay()` | command | Starts movie playback (backend-paced by movie_fps). | implemented | [doc](features/topics/movies-scenes-states.md#mplay) |
| `mset` `mset(specification='', frame=1, freeze=0)` | command | Defines the frame->state program via a mini-language (N, xN repeat, -N ramp). | implemented | [doc](features/topics/movies-scenes-states.md#mset) |
| `mstop` `mstop()` | command | Stops movie playback. | implemented | [doc](features/commands/mstop.md) |
| `mtoggle` `mtoggle()` | command | Toggles movie playback (Spacebar / End). | implemented | [doc](features/topics/movies-scenes-states.md#mtoggle) |
| `mview` `mview(action='store', first=0, last=0, power=0.0, bias=-1.0, simple=-1, linear=0.0, object='', wrap=-1, hand=0, window=5, cycles=1, scene='', cut=0.5, quiet=1, auto=-1, state=0, freeze=0)` | command | Stores and interpolates camera/object key frames; power/linear control easing. | implemented | [doc](features/topics/movies-scenes-states.md#mview) |
| `rewind` `rewind()` | command | Jumps the movie to its first frame. | implemented | [doc](features/commands/rewind.md) |
| `scene` `scene(key='auto', action='recall', message=None, view=1, color=1, active=1, rep=1, frame=1, animate=-1, new_key=None, hand=1, quiet=1, sele='all')` | command | Stores and recalls named scenes capturing camera, visibility, colors, representations, frame, and a message. | planned | [doc](features/commands/scene.md) |
| `scene_order` `scene_order(names, sort=0, location='current', quiet=1)` | command | Reorders stored scenes, optionally sorting them and placing them at the top, current, or bottom. | planned | [doc](features/commands/scene_order.md) |
| `scene_recall_message` `scene_recall_message(message)` | command | Internal helper that displays (or clears) a scene's text message via the Message wizard. | internal | [doc](features/commands/scene_recall_message.md) |
| `set_frame` `set_frame(frame=1, mode=0)` | command | Internal command that sets the current global movie frame (1-based). | implemented | [doc](features/commands/set_frame.md) |
| `set_scene_message` `set_scene_message(name, message)` | command | Sets the text message/annotation associated with a named scene. | unknown | [doc](features/commands/set_scene_message.md) |
| `set_state_order` `set_state_order(name, order, quiet=1)` | command | API-only command to reorder the states of a multi-state object via an index array. | implemented | [doc](features/commands/set_state_order.md) |
| `set_title` `set_title(object, state, text)` | command | Attaches a text label to a particular state of an object, shown next to the object name when that state is active. | unknown | [doc](features/commands/set_title.md) |
| `spheroid` `spheroid(object='', average=0)` | command | Averages trajectory frames to build an ellipsoid-like approximation of an atom's anisotropic motion. | partial | [doc](features/commands/spheroid.md) |
| `split_states` `split_states(object, first=1, last=0, prefix=None)` | command | Separates a multi-state molecular object into a set of single-state objects. | implemented | [doc](features/commands/split_states.md) |
| `camera-framing` | feature | The framing verbs zoom/center/orient/reset that reposition the camera over a selection. | implemented | [doc](features/topics/movies-scenes-states.md#camera-framing) |
| `movie-programs` | feature | The pymol.movie add_* generators that program camera/state/scene loops in one call. | implemented | [doc](features/topics/movies-scenes-states.md#movie-programs) |
| `scene-fkeys` | feature | F1-F12 recall/store scenes (falling back to views); PgUp/PgDn step scenes. | implemented | [doc](features/topics/movies-scenes-states.md#scene-fkeys) |
| `sequence-viewer` | feature | In-viewport residue/atom grid (Seeker) whose cell clicks build the active selection. | implemented | [doc](features/topics/movies-scenes-states.md#sequence-viewer) |
| `set_state` | feature | No dedicated command; set state via frame/set_frame or the per-object 'state' setting. | implemented | [doc](features/topics/movies-scenes-states.md#set_state) |
| `state-vs-frame` | feature | Objects hold states (coordinate sets); the viewer has frames; mset maps frame->state, otherwise 1:1. | implemented | [doc](features/topics/movies-scenes-states.md#state-vs-frame) |
| `scene_animation_duration` | setting | Seconds of camera animation when recalling a scene (animate=-1). | implemented | [doc](features/topics/movies-scenes-states.md#scene_animation_duration) |
| `scene_buttons` | setting | Draws the in-viewport clickable scene-button overlay. | implemented | [doc](features/topics/movies-scenes-states.md#scene_buttons) |
| `seq_view` | setting | Shows/hides the sequence viewer for an object. | implemented | [doc](features/topics/movies-scenes-states.md#seq_view) |
| `seq_view_format` | setting | Sequence-viewer display mode: residue codes/names, atom names, chains, states. | implemented | [doc](features/topics/movies-scenes-states.md#seq_view_format) |
| `static_singletons` | setting | Keeps single-state objects visible in every movie frame. | implemented | [doc](features/topics/movies-scenes-states.md#static_singletons) |

## objects-groups (18)

| Feature | Kind | Summary | Parity | Doc |
| --- | --- | --- | --- | --- |
| `copy` `copy(target, source, zoom=-1)` | command | Creates a new object that is an identical copy of an existing object. | unknown | [doc](features/commands/copy.md) |
| `copy_to` `copy_to(name, selection, rename='chain segi ID', zoom=-1, quiet=1)` | command | Copies a selection into an object (all states), renaming chain/segi/ID to avoid conflicts. | implemented | [doc](features/commands/copy_to.md) |
| `create` `create(name, selection, source_state=0, target_state=0, discrete=0, zoom=-1, quiet=1, singletons=0, extract=None, copy_properties=False)` | command | Creates a new molecule object from a selection, or copies states into an existing object. | unknown | [doc](features/commands/create.md) |
| `curve_new` `curve_new(name='', curve_type='bezier')` | command | Creates a new curve object (currently only Bezier curves). | implemented | [doc](features/commands/curve_new.md) |
| `disable` `disable(name='all')` | command | Turns off display of one or more objects and/or selection indicators. | implemented | [doc](features/commands/disable.md) |
| `enable` `enable(name='all', parents=0)` | command | Turns on display of one or more objects and/or shows selection indicator dots. | implemented | [doc](features/commands/enable.md) |
| `extract` `extract(name, selection, *arg, **kw)` | command | Shorthand for `create` with extract enabled — moves selected atoms into a new object, removing them from the source. | implemented | [doc](features/commands/extract.md) |
| `get_legal_name` `get_legal_name(name)` | command | Sanitizes a candidate string into a legal PyMOL object/selection name. | unknown | [doc](features/commands/get_legal_name.md) |
| `get_names_of_type` `get_names_of_type(type, public=1)` | command | Returns the names of all objects matching a given get_type string. | unknown | [doc](features/commands/get_names_of_type.md) |
| `get_object_list` `get_object_list(selection='(all)', quiet=1)` | command | Returns the object names covered by a selection (unsupported command). | unknown | [doc](features/commands/get_object_list.md) |
| `get_unused_name` `get_unused_name(prefix='tmp', alwaysnumber=1)` | command | Return an object/selection name not currently in use, derived from a prefix. | unknown | [doc](features/commands/get_unused_name.md) |
| `group` `group(name, members='', action='auto', quiet=1)` | command | Creates or updates a group object containerizing other objects into a hierarchy. | implemented | [doc](features/commands/group.md) |
| `group_sc` `group_sc(sc=<Shortcut>, gnot=<opaque>)` | command | Internal shortcut/auto-completion helper for group action keywords. | internal | [doc](features/commands/group_sc.md) |
| `order` `order(names, sort=0, location='current')` | command | Reorders (or sorts) object and selection names in the control panel. | implemented | [doc](features/commands/order.md) |
| `set_discrete` `set_discrete(name, discrete=1, quiet=1)` | command | Converts a molecular object between discrete and non-discrete (shared-topology) multi-state storage. | implemented | [doc](features/commands/set_discrete.md) |
| `set_name` `set_name(old_name, new_name)` | command | Renames an object or a named selection. | implemented | [doc](features/commands/set_name.md) |
| `split_chains` `split_chains(selection='(all)', prefix=None, group=None, quiet=1)` | command | Creates a single new object for each chain found in a selection. | unknown | [doc](features/commands/split_chains.md) |
| `ungroup` `ungroup(members, quiet=1)` | command | Removes an object from a group, returning it to the top level. | implemented | [doc](features/commands/ungroup.md) |

## presets (28)

| Feature | Kind | Summary | Parity | Doc |
| --- | --- | --- | --- | --- |
| `pretty` `pretty(selection='(all)', *, solv=False)` | command | Applies a clean cartoon-plus-ligand-sticks display preset to a selection. | implemented | [doc](features/commands/pretty.md) |
| `publication` `publication(selection='(all)', *, solv=False)` | command | Applies a publication-quality cartoon display preset built on top of pretty. | implemented | [doc](features/commands/publication.md) |
| `simple` `simple(selection='(all)')` | command | Preset that draws structures as color-by-chain ribbons with lines/sticks for cysteines and ligands. | implemented | [doc](features/commands/simple.md) |
| `technical` `technical(selection='(all)')` | command | Applies the 'technical' visual preset — chainbow ribbon, colored ligands, non-bonded atoms and hydrogen-bond dashes. | implemented | [doc](features/commands/technical.md) |
| `_prepare` `_prepare(selection, polar_contacts=None)` | feature | Internal helper every preset calls first: names the scratch selection, resets cartoons/reps, and unsets prior per-object settings. | internal | [doc](features/topics/presets.md#_prepare-internal-helper) |
| `get_sname_oname_dname` `get_sname_oname_dname(selection)` | feature | Internal helper resolving a selection into scratch-name, object-name(s), and the polar-contacts distance-object name. | internal | [doc](features/topics/presets.md#get_sname_oname_dname-internal-helper) |
| `b_factor_putty` `b_factor_putty(selection='(name CA+P)')` | preset | B-factor-colored putty cartoon tube over the CA/P backbone. | implemented | [doc](features/topics/presets.md#b_factor_putty) |
| `ball_and_stick` `ball_and_stick(selection='(all)', mode=1)` | preset | Ball-and-stick view: white thin sticks plus scaled spheres (mode 1) or stick-ball rendering (mode 2). | implemented | [doc](features/topics/presets.md#ball_and_stick) |
| `classified` `classified(selection='*')` | preset | Sets reps from atom classification (polymer=cartoon, organic=sticks, inorganic=spheres); no color/setting changes. | implemented | [doc](features/topics/presets.md#classified) |
| `default` `default(selection='(all)')` | preset | Plain default rep: lines + nonbonded, carbons colored by object color (or green by element if unset). | implemented | [doc](features/topics/presets.md#default) |
| `interface` `interface(selection='*')` | preset | Protein-protein interface preset: color-by-chain cartoon with cross-chain contact residues as sticks/nb_spheres. | implemented | [doc](features/topics/presets.md#interface) |
| `ligand_cartoon` `ligand_cartoon(selection='(all)')` | preset | Cartoon-based binding-site view: ligand_sites promoted to cartoon with side-chain helper on, surface hidden. | implemented | [doc](features/topics/presets.md#ligand_cartoon) |
| `ligand_sites` `ligand_sites(selection='(all)')` | preset | Ligand view with a solid molecular surface over the binding pocket; base for the ligand_sites_* variants. | implemented | [doc](features/topics/presets.md#ligand_sites) |
| `ligand_sites_dots` `ligand_sites_dots(selection='(all)')` | preset | ligand_sites with a dot surface (surface_type 1, surface_quality 1) and pocket lines shown as sticks. | implemented | [doc](features/topics/presets.md#ligand_sites_dots) |
| `ligand_sites_hq` `ligand_sites_hq(selection='(all)')` | preset | ligand_sites with a high-quality solid surface (surface_quality 1, surface_type 0). | implemented | [doc](features/topics/presets.md#ligand_sites_hq) |
| `ligand_sites_mesh` `ligand_sites_mesh(selection='(all)')` | preset | ligand_sites with a mesh surface (surface_type 2) and pocket lines shown as sticks. | implemented | [doc](features/topics/presets.md#ligand_sites_mesh) |
| `ligand_sites_trans` `ligand_sites_trans(selection='(all)')` | preset | ligand_sites with a transparent solid surface (transparency 0.33) and pocket lines shown as sticks. | implemented | [doc](features/topics/presets.md#ligand_sites_trans) |
| `ligand_sites_trans_hq` `ligand_sites_trans_hq(selection='(all)')` | preset | ligand_sites with a transparent, high-quality surface (transparency 0.33, surface_quality 1). | implemented | [doc](features/topics/presets.md#ligand_sites_trans_hq) |
| `ligands` `ligands(selection='(all)')` | preset | Ligand-centric view: chainbow ribbon host, ligand sticks, pocket lines, H-bond dashes, no surface. | implemented | [doc](features/topics/presets.md#ligands) |
| `pretty` `pretty(selection='(all)', *, solv=False)` | preset | Nice cartoon with count-spectrum chains and ligand sticks; assigns SS and flattens sheets. | implemented | [doc](features/topics/presets.md#pretty) |
| `pretty_no_solv` `pretty_no_solv(selection='(all)')` | preset | Module-level alias of pretty (solvent off). | implemented | [doc](features/topics/presets.md#pretty_no_solv) |
| `pretty_solv` `pretty_solv(selection='(all)')` | preset | pretty with solvent shown: ligands and waters drawn as licorice. | implemented | [doc](features/topics/presets.md#pretty_solv) |
| `pub_no_solv` `pub_no_solv(selection='(all)')` | preset | Module-level alias of publication (solvent off). | implemented | [doc](features/topics/presets.md#pub_no_solv) |
| `pub_solv` `pub_solv(selection='(all)')` | preset | publication with solvent shown as licorice. | implemented | [doc](features/topics/presets.md#pub_solv) |
| `publication` `publication(selection='(all)', *, solv=False)` | preset | Publication-quality cartoon: pretty plus smooth loops, fancy helices, and grey50 highlight color. | implemented | [doc](features/topics/presets.md#publication) |
| `simple` `simple(selection='(all)')` | preset | Color-by-chain ribbon overview with disulfide cysteines and ligands drawn as lines/sticks. | implemented | [doc](features/topics/presets.md#simple) |
| `simple_no_solv` `simple_no_solv(selection='(all)')` | preset | Same as simple but with solvent (waters/ions) hidden. | implemented | [doc](features/topics/presets.md#simple_no_solv) |
| `technical` `technical(selection='(all)')` | preset | Detailed all-atom view: chainbow ribbon, lines, ligand sticks, nonbonded, and intramolecular H-bond dashes. | implemented | [doc](features/topics/presets.md#technical) |

## properties (2)

| Feature | Kind | Summary | Parity | Doc |
| --- | --- | --- | --- | --- |
| `get_property` `get_property(propname, name, state=0, quiet=1)` | command | Read a single named object-level property from an object for a given state. | implemented | [doc](features/commands/get_property.md) |
| `get_property_list` `get_property_list(object, state=0, quiet=1)` | command | Return all object-level properties of an object (for a given state) as a list. | implemented | [doc](features/commands/get_property_list.md) |

## querying (34)

| Feature | Kind | Summary | Parity | Doc |
| --- | --- | --- | --- | --- |
| `alter` `alter(selection, expression, quiet=1, space=None)` | command | Change atomic properties via a Python expression evaluated per atom; run sort afterward. | implemented | [doc](features/topics/querying-properties.md#alter) |
| `centerofmass` `centerofmass(selection='(all)', state=-1, quiet=1)` | command | Computes the mass- and occupancy-weighted center of mass of a selection. | implemented | [doc](features/commands/centerofmass.md) |
| `count_atoms` `count_atoms(selection='(all)', quiet=1, state=0, domain='')` | command | Returns the number of atoms matching a selection. | implemented | [doc](features/commands/count_atoms.md) |
| `count_discrete` `count_discrete(selection, quiet=1)` | command | Counts the number of discrete objects spanned by a selection. | implemented | [doc](features/commands/count_discrete.md) |
| `find_pairs` `find_pairs(selection1, selection2, state1=1, state2=1, cutoff=3.5, mode=0, angle=45)` | command | API-only function returning a list of (model,index) atom pairs within a distance cutoff, optionally restricted to hydrogen-bond-like geometry. | implemented | [doc](features/commands/find_pairs.md) |
| `get_angle` `get_angle(atom1='pk1', atom2='pk2', atom3='pk3', state=-1, quiet=1)` | command | Return the angle (degrees) between three atoms in a state. | implemented | [doc](features/topics/querying-properties.md#get_angle) |
| `get_area` `get_area(selection='(all)', state=1, load_b=0, quiet=1)` | command | Compute molecular surface area of a selection (SES/SASA per dot_solvent), optionally into b-factors. | implemented | [doc](features/topics/querying-properties.md#get_area) |
| `get_atom_coords` `get_atom_coords(selection, state=0, quiet=1)` | command | Return the [x,y,z] coordinates of a single atom; errors on 0 or >1 matches. | implemented | [doc](features/topics/querying-properties.md#get_atom_coords) |
| `get_bonds` `get_bonds(selection='(all)', state=-1)` | command | Returns a list of (atm1, atm2, order) tuples for bonds in the given state. | implemented | [doc](features/commands/get_bonds.md) |
| `get_chains` `get_chains(selection='(all)', state=0, quiet=1)` | command | List the chain identifiers present in a selection (state currently ignored). | implemented | [doc](features/topics/querying-properties.md#get_chains) |
| `get_color_index` `get_color_index(color)` | command | Return the internal integer color index for a color name/spec. | implemented | [doc](features/topics/querying-properties.md#get_color_index) |
| `get_color_tuple` `get_color_tuple(name, mode=0)` | command | Return the (r,g,b) tuple in 0.0-1.0 for a color name/index. | implemented | [doc](features/topics/querying-properties.md#get_color_tuple) |
| `get_coords` `get_coords(selection='all', state=1, quiet=1)` | command | Returns a selection's coordinates as a NumPy array (API-only). | implemented | [doc](features/commands/get_coords.md) |
| `get_coordset` `get_coordset(name, state=1, copy=1, quiet=1)` | command | Returns an object's coordinate set for a state as a NumPy array (API-only). | implemented | [doc](features/commands/get_coordset.md) |
| `get_distance` `get_distance(atom1='pk1', atom2='pk2', state=-1, quiet=1)` | command | Return the distance (Angstroms) between two atoms in a state, without creating an object. | implemented | [doc](features/topics/querying-properties.md#get_distance) |
| `get_drag_object_name` `get_drag_object_name()` | command | Returns the name of the object currently in drag (mouse-move) mode. | unknown | [doc](features/commands/get_drag_object_name.md) |
| `get_names` `get_names(type='public_objects', enabled_only=0, selection='')` | command | Return object and/or selection names by type (objects/selections/public/groups). | implemented | [doc](features/topics/querying-properties.md#get_names) |
| `get_object_matrix` `get_object_matrix(object, state=1, incl_ttt=1)` | command | Query the transformation matrix (object + optional TTT) associated with an object for a given state. | unknown | [doc](features/commands/get_object_matrix.md) |
| `get_object_settings` `get_object_settings(object, state=0, quiet=1)` | command | Query the per-object (and per-state) setting overrides stored on an object. | unknown | [doc](features/commands/get_object_settings.md) |
| `get_object_state` `get_object_state(name)` | command | Return the effective (currently displayed) state index for a single object. | implemented | [doc](features/commands/get_object_state.md) |
| `get_object_ttt` `get_object_ttt(object, quiet=1)` | command | Query an object's TTT (transient transformation) matrix, optionally printing it. | unknown | [doc](features/commands/get_object_ttt.md) |
| `get_phipsi` `get_phipsi(selection='(name CA)', state=-1)` | command | Return backbone (phi,psi) angles per residue keyed by (object,index). | implemented | [doc](features/topics/querying-properties.md#get_phipsi) |
| `get_selection_state` `get_selection_state(selection)` | command | Return the single effective object state shared by all objects in a selection, or raise if they differ. | partial | [doc](features/commands/get_selection_state.md) |
| `get_type` `get_type(name, quiet=1)` | command | Return a string describing a named object or selection (object:molecule, selection, ...). | implemented | [doc](features/topics/querying-properties.md#get_type) |
| `get_version` `get_version(quiet=1)` | command | Return the PyMOL version tuple (text, float, int, build date, git sha, svn rev). | implemented | [doc](features/topics/querying-properties.md#get_version) |
| `id_atom` `id_atom(selection, mode=0, quiet=1)` | command | Returns the source ID of a single atom, raising if zero or multiple atoms match. | implemented | [doc](features/commands/id_atom.md) |
| `identify` `identify(selection='(all)', mode=0, quiet=1)` | command | Return stable source atom IDs (optionally as (object,id) tuples) for a selection. | implemented | [doc](features/topics/querying-properties.md#identify) |
| `index` `index(selection='(all)', quiet=1)` | command | Return fragile (object, 1-based index) tuples for atoms in a selection. | implemented | [doc](features/topics/querying-properties.md#index) |
| `iterate` `iterate(selection, expression=None, quiet=1, space=None)` | command | Evaluate a read-only Python expression once per atom in a selection within a temporary namespace. | implemented | [doc](features/commands/iterate.md) |
| `iterate_state` `iterate_state(state, selection, expression, quiet=1, space=None, atomic=1)` | command | Evaluate a read-only Python expression per atom for a specific coordinate state, exposing x/y/z. | implemented | [doc](features/commands/iterate_state.md) |
| `phi_psi` `phi_psi(selection='(byres pk1)', quiet=1)` | command | Return and optionally pretty-print phi/psi angles for a protein selection. | implemented | [doc](features/topics/querying-properties.md#phi_psi) |
| `set_atom_property` `set_atom_property(name, value, selection='all', state=0, proptype=-1, quiet=1)` | command | Set an atom-level custom property, reachable in iterate/alter via the p object. | implemented | [doc](features/topics/querying-properties.md#set_atom_property) |
| `set_property` `set_property(name, value, object='*', state=0, proptype=-1, quiet=1)` | command | Set an object-level custom property with typed or auto-detected value. | implemented | [doc](features/topics/querying-properties.md#set_property) |
| `atom-namespace` | feature | The per-atom symbol vocabulary (name, resn, resi, chain, b, q, elem, x/y/z, partial_charge, ...) exposed to iterate/alter. | implemented | [doc](features/topics/querying-properties.md#atom-namespace) |

## rendering-export (29)

| Feature | Kind | Summary | Parity | Doc |
| --- | --- | --- | --- | --- |
| `cache` `cache(action='optimize', scenes='', state=-1, quiet=1)` | command | Manages storage of precomputed results such as molecular surfaces. | partial | [doc](features/commands/cache.md) |
| `capture` `capture(quiet=1)` | command | Captures the current frame as an antialiased OpenGL image. | partial | [doc](features/commands/capture.md) |
| `copy_image` `copy_image(quiet=1)` | command | Copies the current rendered image to the system clipboard (incentive/proprietary, GUI-thread only). | planned | [doc](features/topics/rendering-export.md#copy_image) |
| `draw` `draw(width=0, height=0, antialias=-1, quiet=1)` | command | Creates a fast OpenGL raster of the current frame (no shadows/ray effects); needs a live GL context. | implemented | [doc](features/topics/rendering-export.md#draw) |
| `dump` `dump(fnam, obj, state=1, quiet=1)` | command | Writes the raw geometry of an isosurface/isomesh/isodot or map object to a plain-text vertex file. | implemented | [doc](features/commands/dump.md) |
| `focal_blur` `focal_blur(aperture=2.0, samples=10, ray=0, filename='', quiet=1)` | command | Produces a depth-of-field image by averaging several jittered renders, keeping the object at the origin in focus. | unknown | [doc](features/commands/focal_blur.md) |
| `get_collada` `get_collada(version=2)` | command | Returns a COLLADA (.dae) string representing the currently displayed scene. | implemented | [doc](features/commands/get_collada.md) |
| `get_gltf` `get_gltf(filename, quiet=1)` | command | Writes a glTF file by exporting COLLADA then converting it via an external collada2gltf binary. | unknown | [doc](features/topics/rendering-export.md#get_gltf) |
| `get_idtf` `get_idtf(quiet=1)` | command | Returns an IDTF (U3D/3D-PDF) export of the scene; under development, prints 3D-PDF view params when not quiet. | unknown | [doc](features/topics/rendering-export.md#get_idtf) |
| `get_image` `get_image()` | command | Returns the last rendered frame's raw RGBA framebuffer — the headless screen-capture accessor. | implemented | [doc](features/topics/rendering-export.md#get_image) |
| `get_mtl_obj` `get_mtl_obj()` | command | Returns a (mtl, obj) Wavefront tuple for Maya; incomplete — the .MTL half is not implemented. | partial | [doc](features/topics/rendering-export.md#get_mtl_obj) |
| `get_povray` `get_povray()` | command | Returns a (header, geometry) tuple forming a complete POV-Ray input file for the current scene. | partial | [doc](features/topics/rendering-export.md#get_povray) |
| `get_renderer` `get_renderer(quiet=1)` | command | Return (and optionally print) the OpenGL vendor / renderer / version strings. | unknown | [doc](features/commands/get_renderer.md) |
| `get_stlstr` `get_stlstr(binary=1, quiet=0)` | command | STL geometry export of surfaces/CGO (reached via save *.stl); raises IncentiveOnlyException in the open build. | planned | [doc](features/topics/rendering-export.md#get_stlstr) |
| `get_vrml` `get_vrml(version=2)` | command | Returns a VRML2 (.wrl) string of the current display for import into other 3D tools. | unknown | [doc](features/topics/rendering-export.md#get_vrml) |
| `ipython_image` `ipython_image(*args, **kwargs)` | command | Renders the scene and returns it as an IPython.display.Image for inline notebook display. | planned | [doc](features/commands/ipython_image.md) |
| `load_png` `load_png(filename, movie=1, stereo=-1, quiet=0)` | command | Load and display a PNG image from disk in the PyMOL viewport, optionally as a movie frame. | partial | [doc](features/commands/load_png.md) |
| `mpng` `mpng(prefix, first=0, last=0, preserve=0, modal=0, mode=-1, quiet=1, width=0, height=0)` | command | Writes the movie as a series of numbered PNG frames, ray-traced or drawn per ray_trace_frames/draw_frames. | partial | [doc](features/topics/rendering-export.md#mpng) |
| `png` `png(filename, width=0, height=0, dpi=-1.0, ray=0, quiet=1, prior=0, format=0)` | command | Saves the current display to a PNG file, optionally ray-tracing first and honouring width/height/dpi. | implemented | [doc](features/topics/rendering-export.md#png) |
| `ray` `ray(width=0, height=0, antialias=-1, angle=0.0, shift=0.0, renderer=-1, quiet=1, async_=0)` | command | Produces a ray-traced image of the current frame with the built-in CPU renderer (shadows, outlines, interior colours, antialiasing). | implemented | [doc](features/topics/rendering-export.md#ray) |
| `write_html_ref` `write_html_ref(file)` | command | Writes the full PyMOL command reference (every keyword + docstring) to a self-contained HTML file. | unknown | [doc](features/topics/rendering-export.md#write_html_ref) |
| `image_dots_per_inch` | setting | DPI written into image files when non-zero; png dpi=-1 falls back to this. | unknown | [doc](features/topics/rendering-export.md#image_dots_per_inch) |
| `opaque_background` | setting | Whether the background is opaque for GL and (when ray_opaque_background=-1) ray output. | partial | [doc](features/topics/rendering-export.md#opaque_background) |
| `ray_default_renderer` | setting | Which renderer ray uses when renderer=-1: 0=built-in, 1=PovRay, 2=geometry counter. | partial | [doc](features/topics/rendering-export.md#ray_default_renderer) |
| `ray_opaque_background` | setting | Whether the ray-traced background is opaque; -1 defers to opaque_background. | partial | [doc](features/topics/rendering-export.md#ray_opaque_background) |
| `ray_shadow` | setting | Whether the ray tracer casts shadows (legacy alias ray_shadows). | implemented | [doc](features/topics/rendering-export.md#ray_shadow) |
| `ray_trace_frames` | setting | When on, mpng/movie export ray-traces every frame instead of drawing it. | partial | [doc](features/topics/rendering-export.md#ray_trace_frames) |
| `ray_trace_gain` | setting | Gain parameter for the ray_trace_mode 1-3 outline darkening. | planned | [doc](features/topics/rendering-export.md#ray_trace_gain) |
| `ray_trace_mode` | setting | Cel-shading/outline style of the built-in ray tracer: 0=normal, 1=colour+outline, 2=B&W outline, 3=quantised. | planned | [doc](features/topics/rendering-export.md#ray_trace_mode) |

## representations-display (38)

| Feature | Kind | Summary | Parity | Doc |
| --- | --- | --- | --- | --- |
| `as` `show_as(representation='wire', selection='')` | command | Exclusive show: turns on one representation and hides all others for the selection. | implemented | [doc](features/topics/representations.md#show_as) |
| `cartoon` `cartoon(type, selection='(all)')` | command | Overrides the cartoon sub-type (loop, tube, arrow, putty, ...) for a selection. | implemented | [doc](features/commands/cartoon.md) |
| `cartoon (command)` `cartoon(type, selection='(all)')` | command | Overrides the per-residue cartoon cross-section (automatic/skip/loop/rectangle/oval/tube/arrow/dumbbell/putty). | implemented | [doc](features/topics/representations.md#cartoon-command) |
| `get_vis` `get_vis()` | command | Return an opaque snapshot of the current visibility state of all objects. | implemented | [doc](features/commands/get_vis.md) |
| `hide` `hide(representation='everything', selection='')` | command | Turns off a representation for atoms/bonds in a selection. | implemented | [doc](features/topics/representations.md#hide) |
| `rebuild` `rebuild(selection='all', representation='everything')` | command | Forces PyMOL to recreate rep geometry that has gone out of sync so it regenerates on next update. | implemented | [doc](features/topics/representations.md#rebuild) |
| `refresh` `refresh()` | command | Requests a scene redraw as soon as the OS allows, without discarding geometry. | implemented | [doc](features/topics/representations.md#refresh) |
| `set_bond` `set_bond(name, value, selection1, selection2=None, ...)` | command | Sets a per-bond representation setting (stick_radius, valence, ...) on bonds between two selections. | implemented | [doc](features/topics/representations.md#set_bond) |
| `set_vis` `set_vis(dict)` | command | Restores object/representation visibility state from a visibility dictionary (counterpart of get_vis). | implemented | [doc](features/commands/set_vis.md) |
| `show` `show(representation='wire', selection='')` | command | Turns on a representation for the atoms/objects in a selection (additive; leaves other representations intact). | implemented | [doc](features/commands/show.md) |
| `show_as` `show_as(representation='wire', selection='')` | command | Exclusively shows one representation for a selection, hiding all others on those atoms (the 'as' command). | implemented | [doc](features/commands/show_as.md) |
| `toggle` `toggle(representation='lines', selection='all')` | command | Toggles the visibility of a representation within an atom selection. | unknown | [doc](features/commands/toggle.md) |
| `cartoon arrow` | feature | Rectangle slab with a C-terminal arrowhead - the beta-strand look (cartoon_fancy_sheets). | implemented | [doc](features/topics/representations.md#cartoon-arrow) |
| `cartoon automatic` | feature | Default cartoon mode picking cross-section per residue from secondary structure (HELIX/SHEET records). | implemented | [doc](features/topics/representations.md#cartoon-automatic) |
| `cartoon dumbbell` | feature | Flat ribbon edged with round rails (cartoon_dumbbell_length/width/radius). | partial | [doc](features/topics/representations.md#cartoon-dumbbell) |
| `cartoon loop` | feature | Force a thin round tube (cartoon_loop_radius) for a selection, ignoring secondary structure. | implemented | [doc](features/topics/representations.md#cartoon-loop) |
| `cartoon oval` | feature | Extrude an elliptical cross-section sized by cartoon_oval_length x cartoon_oval_width. | partial | [doc](features/topics/representations.md#cartoon-oval) |
| `cartoon putty` | feature | Variable-radius B-factor sausage tube mapping a per-atom property to thickness. | partial | [doc](features/topics/representations.md#cartoon-putty) |
| `cartoon rectangle` | feature | Extrude a flat rectangular slab (cartoon_rect_length x cartoon_rect_width) for a selection. | implemented | [doc](features/topics/representations.md#cartoon-rectangle) |
| `cartoon tube` | feature | Force a fat round backbone tube (cartoon_tube_radius) with capped ends. | partial | [doc](features/topics/representations.md#cartoon-tube) |
| `ramp` `ramp_new(name, map_name, range=[-1.0,0.0,1.0], color=..., ...)` | feature | Colour-ramp legend gadget that both documents and drives continuous colouring by map potential/proximity. | unknown | [doc](features/topics/representations.md#ramp-color-gadget) |
| `cartoon` | representation | Schematic secondary-structure ribbon: arrowed strands, wide helices, loop tubes, nucleic ladders. | implemented | [doc](features/topics/representations.md#cartoon) |
| `cgo` | representation | User-supplied Compiled Graphics Objects (triangles/lines/spheres/cylinders) loaded with load_cgo. | partial | [doc](features/topics/representations.md#cgo) |
| `dashes` | representation | Dashed-line geometry for distance/angle/dihedral measurement objects. | implemented | [doc](features/topics/representations.md#dashes) |
| `dots` | representation | Point cloud sampling the molecular/VDW surface, each dot carrying a normal and area. | implemented | [doc](features/topics/representations.md#dots) |
| `ellipsoids` | representation | Thermal-displacement (ADP/ANISOU) probability ellipsoids, one per atom. | implemented | [doc](features/topics/representations.md#ellipsoids) |
| `extent` | representation | Axis-aligned bounding-box wireframe around a selection's coordinate extent. | implemented | [doc](features/topics/representations.md#extent) |
| `labels` | representation | Per-atom text drawn as camera-facing textured glyph quads. | partial | [doc](features/topics/representations.md#labels) |
| `lines` | representation | Wireframe rep drawing one coloured line segment per bond. | implemented | [doc](features/topics/representations.md#lines) |
| `mesh` | representation | Wireframe isomesh over the molecular surface or a volumetric map. | implemented | [doc](features/topics/representations.md#mesh) |
| `nb_spheres` | representation | Fixed-size solid spheres at non-bonded atoms (compact alternative to nonbonded crosses). | implemented | [doc](features/topics/representations.md#nb_spheres) |
| `nonbonded` | representation | Small 3D crosses marking atoms that have no bonds (ions, waters). | implemented | [doc](features/topics/representations.md#nonbonded) |
| `ribbon` | representation | Thin backbone trace (line or thin cylinder) through Ca/C4' atoms, no SS cross-section. | implemented | [doc](features/topics/representations.md#ribbon) |
| `slice` | representation | 2D false-coloured slice plane sampled through a map field. | planned | [doc](features/topics/representations.md#slice) |
| `spheres` | representation | Space-filling CPK spheres, radius = VDW radius x sphere_scale. | implemented | [doc](features/topics/representations.md#spheres) |
| `sticks` | representation | Bonds drawn as half-coloured cylinders with joint spheres (ball-and-stick optional). | implemented | [doc](features/topics/representations.md#sticks) |
| `surface` | representation | Smooth solvent-excluded/accessible molecular surface as a coloured triangle mesh. | implemented | [doc](features/topics/representations.md#surface) |
| `volume` | representation | Direct volume rendering of a map via 3D-texture ray-marching with a transfer function. | planned | [doc](features/topics/representations.md#volume) |

## sculpting-minimization (56)

| Feature | Kind | Summary | Parity | Doc |
| --- | --- | --- | --- | --- |
| `clean` `clean(selection, present='', state=-1, fix='', restrain='', method='mmff', async_=0, save_undo=1, message=None)` | command | MMFF94 energy-minimization 'clean up' of a selection — an incentive-only feature, so Open-Source PyMOL and the TS engine both raise IncentiveOnlyException. | implemented | [doc](features/commands/clean.md) |
| `fast_minimize` `fast_minimize(*args, **kwargs)` | command | Unsupported, nonfunctional placeholder that may eventually perform a quick structure clean-up. | internal | [doc](features/commands/fast_minimize.md) |
| `minimize` `minimize(sele='', iter=500, grad=0.01, interval=50, _setup=1)` | command | Batch energy minimization; upstream stub routing to chempy.tinker, ported as covalent-radius idealisation. | implemented | [doc](features/topics/sculpting-minimization.md#minimize) |
| `sculpt_activate` `sculpt_activate(object, state=0, match_state=-1, match_by_segment=0)` | command | Enables sculpting for an object and snapshots its current geometry as the reference for restraints. | implemented | [doc](features/topics/sculpting-minimization.md#sculpt_activate) |
| `sculpt_deactivate` `sculpt_deactivate(object)` | command | Turns off sculpting for an object and discards its stored geometry restraints. | implemented | [doc](features/commands/sculpt_deactivate.md) |
| `sculpt_iterate` `sculpt_iterate(object, state=-1, cycles=10)` | command | Runs N cycles of restraint-based energy minimization on a sculpt-activated object and returns the strain energy. | implemented | [doc](features/topics/sculpting-minimization.md#sculpt_iterate) |
| `sculpt_purge` `sculpt_purge()` | command | Flushes all cached sculpt restraint sets globally (upstream: unsupported feature). | implemented | [doc](features/topics/sculpting-minimization.md#sculpt_purge) |
| `cSculptAngl` | feature | 0x002 1-3 bond-angle harmonic restraint term (on in default mask). | implemented | [doc](features/topics/sculpting-minimization.md#force-field-terms--the-sculpt_field_mask-flags) |
| `cSculptAvoid` | feature | 0x800 avoidance restraint term (off in default mask). | planned | [doc](features/topics/sculpting-minimization.md#force-field-terms--the-sculpt_field_mask-flags) |
| `cSculptBond` | feature | 0x001 bond-length harmonic restraint term (on in default sculpt_field_mask). | implemented | [doc](features/topics/sculpting-minimization.md#force-field-terms--the-sculpt_field_mask-flags) |
| `cSculptLine` | feature | 0x010 linearity restraint term (on in default mask). | planned | [doc](features/topics/sculpting-minimization.md#force-field-terms--the-sculpt_field_mask-flags) |
| `cSculptMax` | feature | 0x400 maximum-distance restraint term (off in default mask). | planned | [doc](features/topics/sculpting-minimization.md#force-field-terms--the-sculpt_field_mask-flags) |
| `cSculptMin` | feature | 0x200 minimum-distance restraint term (off in default mask). | planned | [doc](features/topics/sculpting-minimization.md#force-field-terms--the-sculpt_field_mask-flags) |
| `cSculptPlan` | feature | 0x008 planarity restraint term (on in default mask). | planned | [doc](features/topics/sculpting-minimization.md#force-field-terms--the-sculpt_field_mask-flags) |
| `cSculptPyra` | feature | 0x004 pyramidal (improper/chirality) restraint term (on in default mask). | planned | [doc](features/topics/sculpting-minimization.md#force-field-terms--the-sculpt_field_mask-flags) |
| `cSculptTors` | feature | 0x080 torsion restraint term (on in default mask). | planned | [doc](features/topics/sculpting-minimization.md#force-field-terms--the-sculpt_field_mask-flags) |
| `cSculptTri` | feature | 0x100 1-4 distance ('triangle') restraint term (on in default mask). | planned | [doc](features/topics/sculpting-minimization.md#force-field-terms--the-sculpt_field_mask-flags) |
| `cSculptVDW` | feature | 0x020 van-der-Waals clash repulsion term (on in default mask). | implemented | [doc](features/topics/sculpting-minimization.md#force-field-terms--the-sculpt_field_mask-flags) |
| `cSculptVDW14` | feature | 0x040 1-4 van-der-Waals repulsion term (on in default mask). | planned | [doc](features/topics/sculpting-minimization.md#force-field-terms--the-sculpt_field_mask-flags) |
| `clean_electro_mode` | setting | Electrostatics term toggle for the 'clean' action (Builder El-stat checkbox). | planned | [doc](features/topics/sculpting-minimization.md#clean) |
| `sculpt_angl_weight` | setting | Weight of the 1-3 bond-angle restraint term. | planned | [doc](features/topics/sculpting-minimization.md#term-weight-settings) |
| `sculpt_avd_excl` | setting | Exclusion depth (in bonds) of the avoidance term. | planned | [doc](features/topics/sculpting-minimization.md#vdw--distance-restraint-settings) |
| `sculpt_avd_gap` | setting | Gap parameter of the avoidance term (-1 = auto). | planned | [doc](features/topics/sculpting-minimization.md#vdw--distance-restraint-settings) |
| `sculpt_avd_range` | setting | Range parameter of the avoidance term (-1 = auto). | planned | [doc](features/topics/sculpting-minimization.md#vdw--distance-restraint-settings) |
| `sculpt_avd_weight` | setting | Weight of the avoidance restraint term. | planned | [doc](features/topics/sculpting-minimization.md#term-weight-settings) |
| `sculpt_bond_weight` | setting | Weight of the bond-length restraint term. | planned | [doc](features/topics/sculpting-minimization.md#term-weight-settings) |
| `sculpt_field_mask` | setting | Bitmask selecting which restraint terms sculpt_iterate applies (default 0x1FF). | planned | [doc](features/topics/sculpting-minimization.md#control-settings) |
| `sculpt_hb_overlap` | setting | vdw overlap allowance granted for potential hydrogen bonds. | planned | [doc](features/topics/sculpting-minimization.md#vdw--distance-restraint-settings) |
| `sculpt_hb_overlap_base` | setting | Base overlap for the hydrogen-bond vdw allowance. | planned | [doc](features/topics/sculpting-minimization.md#vdw--distance-restraint-settings) |
| `sculpt_max_max` | setting | Upper bound of the maximum-distance restraint range. | planned | [doc](features/topics/sculpting-minimization.md#vdw--distance-restraint-settings) |
| `sculpt_max_min` | setting | Lower bound of the maximum-distance restraint range. | planned | [doc](features/topics/sculpting-minimization.md#vdw--distance-restraint-settings) |
| `sculpt_max_scale` | setting | Scale for the maximum-distance restraint target. | planned | [doc](features/topics/sculpting-minimization.md#vdw--distance-restraint-settings) |
| `sculpt_memory` | setting | Reuse cached restraints across sculpt activations. | planned | [doc](features/topics/sculpting-minimization.md#control-settings) |
| `sculpt_min_max` | setting | Upper bound of the minimum-distance restraint range. | planned | [doc](features/topics/sculpting-minimization.md#vdw--distance-restraint-settings) |
| `sculpt_min_min` | setting | Lower bound of the minimum-distance restraint range. | planned | [doc](features/topics/sculpting-minimization.md#vdw--distance-restraint-settings) |
| `sculpt_min_scale` | setting | Scale for the minimum-distance restraint target. | planned | [doc](features/topics/sculpting-minimization.md#vdw--distance-restraint-settings) |
| `sculpt_min_weight` | setting | Weight of the minimum-distance restraint term. | planned | [doc](features/topics/sculpting-minimization.md#term-weight-settings) |
| `sculpt_nb_interval` | setting | Cycles between nonbonded neighbour-list rebuilds during sculpting. | planned | [doc](features/topics/sculpting-minimization.md#control-settings) |
| `sculpt_plan_weight` | setting | Weight of the planarity restraint term. | planned | [doc](features/topics/sculpting-minimization.md#term-weight-settings) |
| `sculpt_pyra_weight` | setting | Weight of the pyramidal (improper) restraint term. | planned | [doc](features/topics/sculpting-minimization.md#term-weight-settings) |
| `sculpt_tors_tolerance` | setting | Angular tolerance before the torsion restraint applies force. | planned | [doc](features/topics/sculpting-minimization.md#term-weight-settings) |
| `sculpt_tors_weight` | setting | Weight of the torsion restraint term. | planned | [doc](features/topics/sculpting-minimization.md#term-weight-settings) |
| `sculpt_tri_max` | setting | Maximum sequence separation for triangle (1-4) distance restraints. | planned | [doc](features/topics/sculpting-minimization.md#vdw--distance-restraint-settings) |
| `sculpt_tri_min` | setting | Minimum sequence separation for triangle (1-4) distance restraints. | planned | [doc](features/topics/sculpting-minimization.md#vdw--distance-restraint-settings) |
| `sculpt_tri_mode` | setting | Triangle (1-4) distance restraint mode selector. | planned | [doc](features/topics/sculpting-minimization.md#vdw--distance-restraint-settings) |
| `sculpt_tri_scale` | setting | Scale for the triangle (1-4) distance restraint target. | planned | [doc](features/topics/sculpting-minimization.md#vdw--distance-restraint-settings) |
| `sculpt_tri_weight` | setting | Weight of the 1-4 distance (triangle) restraint term. | planned | [doc](features/topics/sculpting-minimization.md#term-weight-settings) |
| `sculpt_vdw_scale` | setting | Scale factor on the summed vdw radii used as the clash target distance. | planned | [doc](features/topics/sculpting-minimization.md#vdw--distance-restraint-settings) |
| `sculpt_vdw_vis_max` | setting | Overlap distance mapped to the high colour of the bumps overlay. | planned | [doc](features/topics/sculpting-minimization.md#vdw-contact-visualization-settings-bumps) |
| `sculpt_vdw_vis_mid` | setting | Overlap distance mapped to the mid colour of the bumps overlay. | planned | [doc](features/topics/sculpting-minimization.md#vdw-contact-visualization-settings-bumps) |
| `sculpt_vdw_vis_min` | setting | Overlap distance mapped to the low colour of the bumps overlay. | planned | [doc](features/topics/sculpting-minimization.md#vdw-contact-visualization-settings-bumps) |
| `sculpt_vdw_vis_mode` | setting | Show a CGO overlay of vdw contacts (bumps) during sculpting. | planned | [doc](features/topics/sculpting-minimization.md#vdw-contact-visualization-settings-bumps) |
| `sculpt_vdw_weight` | setting | Weight of the van-der-Waals clash repulsion term. | planned | [doc](features/topics/sculpting-minimization.md#term-weight-settings) |
| `sculpt_vdw_weight14` | setting | Weight of the 1-4 van-der-Waals repulsion term. | planned | [doc](features/topics/sculpting-minimization.md#term-weight-settings) |
| `sculpting` | setting | Master switch controlling whether sculpting is performed. | partial | [doc](features/topics/sculpting-minimization.md#control-settings) |
| `sculpting_cycles` | setting | Number of sculpting iterations performed per interactive update. | partial | [doc](features/topics/sculpting-minimization.md#control-settings) |

## selecting (92)

| Feature | Kind | Summary | Parity | Doc |
| --- | --- | --- | --- | --- |
| `deselect` `deselect()` | command | Disables (hides) all currently visible named selections. | unknown | [doc](features/commands/deselect.md) |
| `flag` `flag(flag, selection, action='reset', quiet=1)` | command | Sets or clears a named/numbered atom flag over a selection, controlling modeling roles like fixed, free, focus, and ignore. | unknown | [doc](features/commands/flag.md) |
| `indicate` `indicate(selection='(all)')` | command | Shows a transient visual overlay marking the atoms of a selection. | implemented | [doc](features/commands/indicate.md) |
| `pop` `pop(name, source, enable=-1, quiet=1)` | command | Moves one atom at a time from a source selection into a named selection. | implemented | [doc](features/commands/pop.md) |
| `select` `select(name, selection='', enable=-1, quiet=1, merge=0, state=0, domain='')` | command | Creates a named atom selection from a selection-expression. | implemented | [doc](features/commands/select.md) |
| `select_list` `select_list(name, object, id_list, state=0, mode='id', quiet=1)` | command | API-only command that selects atoms of one object by an explicit list of IDs, indices, or ranks. | planned | [doc](features/commands/select_list.md) |
| `unmask` `unmask(selection='(all)', quiet=1)` | command | Reverses the effect of "mask" on the indicated atoms, re-enabling mouse picking. | implemented | [doc](features/commands/unmask.md) |
| `acceptors` | selection | Candidate hydrogen-bond acceptor atoms (acc.). | implemented | [doc](features/topics/selection-algebra.md#acceptors) |
| `all` | selection | Every atom in every object (*); also the value of an empty expression. | implemented | [doc](features/topics/selection-algebra.md#all) |
| `alt` | selection | Selects atoms by alternate-location identifier (altloc); empty value matches no-altloc atoms. | implemented | [doc](features/topics/selection-algebra.md#alt) |
| `and` | selection | Set intersection of two operands (& / implicit-and between adjacent terms). | implemented | [doc](features/topics/selection-algebra.md#and) |
| `around` | selection | Atoms within a distance of A, excluding A itself (a.). | implemented | [doc](features/topics/selection-algebra.md#around) |
| `b` | selection | Numeric comparison on the B-factor / temperature-factor column. | implemented | [doc](features/topics/selection-algebra.md#b) |
| `backbone` | selection | Polymer backbone atoms (bb.). | implemented | [doc](features/topics/selection-algebra.md#backbone) |
| `beyond` | selection | Atoms of A farther than a distance from every atom of B (be.). | implemented | [doc](features/topics/selection-algebra.md#beyond) |
| `bonded` | selection | Atoms that participate in at least one bond. | implemented | [doc](features/topics/selection-algebra.md#bonded) |
| `bound_to` | selection | Atoms directly bonded to the selection, retaining the seed itself (bto.). | implemented | [doc](features/topics/selection-algebra.md#bound_to) |
| `bycalpha` | selection | The C-alpha atom of every residue the operand touches (bca.). | implemented | [doc](features/topics/selection-algebra.md#bycalpha) |
| `bycell` | selection | Expands the selection to atoms in the same crystallographic unit-cell neighbourhood. | unknown | [doc](features/topics/selection-algebra.md#bycell) |
| `bychain` | selection | Expands the selection to every atom of every chain it touches (bc.). | implemented | [doc](features/topics/selection-algebra.md#bychain) |
| `byfragment` | selection | Expands a selection to the editor's picked fragments (bf.); with no editor fragments defined it selects nothing — NOT the whole connected molecule. | implemented | [doc](features/topics/selection-algebra.md#byfragment) |
| `bymol` | selection | Expands the selection to every atom of every bonded molecule it touches (bm.). | implemented | [doc](features/topics/selection-algebra.md#bymol) |
| `byobject` | selection | Expands the selection to every atom of every object it touches (bo.). | implemented | [doc](features/topics/selection-algebra.md#byobject) |
| `byres` | selection | Expands the selection to every atom of every residue it touches (br.). | implemented | [doc](features/topics/selection-algebra.md#byres) |
| `byring` | selection | Atoms on a ring (size <= 7) containing a seed atom. | implemented | [doc](features/topics/selection-algebra.md#byring) |
| `bysegment` | selection | Expands the selection to every atom of every segment (segi) it touches (bs.). | unknown | [doc](features/topics/selection-algebra.md#bysegment) |
| `cartoon_color` | selection | Atoms whose per-atom cartoon_color setting equals a colour index or name. | unknown | [doc](features/topics/selection-algebra.md#cartoon_color) |
| `center` | selection | A pseudo-atom at the current scene centre, for distance queries. | unknown | [doc](features/topics/selection-algebra.md#center) |
| `chain` | selection | Selects atoms by chain identifier (c.). | implemented | [doc](features/topics/selection-algebra.md#chain) |
| `color` | selection | Atoms whose colour equals a colour index or name (color <n>). | implemented | [doc](features/topics/selection-algebra.md#color) |
| `coordinate-ranges` | selection | Numeric comparison on an atom's x/y/z Cartesian coordinate. | unknown | [doc](features/topics/selection-algebra.md#coordinate-ranges) |
| `custom` | selection | Selects atoms by the custom per-atom annotation string. | unknown | [doc](features/topics/selection-algebra.md#custom) |
| `delocalized` | selection | Atoms in a delocalized bond where explicit degree differs from valence (deloc.). | implemented | [doc](features/topics/selection-algebra.md#delocalized) |
| `donors` | selection | Candidate hydrogen-bond donor atoms (don.). | implemented | [doc](features/topics/selection-algebra.md#donors) |
| `elem` | selection | Selects atoms by chemical element symbol (e./symbol/element). | implemented | [doc](features/topics/selection-algebra.md#elem) |
| `enabled` | selection | Atoms belonging to a currently enabled object. | implemented | [doc](features/topics/selection-algebra.md#enabled) |
| `expand` | selection | A plus everything within a distance of it (x.). | implemented | [doc](features/topics/selection-algebra.md#expand) |
| `extend` | selection | Grows the selection outward by a number of covalent bonds, not distance (xt.). | unknown | [doc](features/topics/selection-algebra.md#extend) |
| `first` | selection | The single lowest-index atom of the operand (first in table order). | implemented | [doc](features/topics/selection-algebra.md#first) |
| `fixed` | selection | Atoms carrying the fix flag (flag 3), held in place during sculpting (fxd.). | unknown | [doc](features/topics/selection-algebra.md#fixed) |
| `flag` | selection | Selects atoms carrying a given flag number 0-31 (f.). | unknown | [doc](features/topics/selection-algebra.md#flag) |
| `formal_charge` | selection | Numeric comparison on integer formal charge (fc.). | implemented | [doc](features/topics/selection-algebra.md#formal_charge) |
| `gap` | selection | Atoms not in A whose VDW surface clears every atom of A by at least a distance. | implemented | [doc](features/topics/selection-algebra.md#gap) |
| `guide` | selection | Cartoon/ribbon guide atoms: protein C-alpha and nucleic C4', one per polymer residue. | unknown | [doc](features/topics/selection-algebra.md#guide) |
| `hetatm` | selection | Atoms flagged as heteroatoms (het). | implemented | [doc](features/topics/selection-algebra.md#hetatm) |
| `hydro` | selection | All hydrogen/deuterium atoms (hydrogens/h.). | implemented | [doc](features/topics/selection-algebra.md#hydro) |
| `id` | selection | Selects atoms by external atom ID (PDB/mmCIF serial), supporting ranges. | implemented | [doc](features/topics/selection-algebra.md#id) |
| `in` | selection | Keeps atoms of A whose full identity also appears in B. | unknown | [doc](features/topics/selection-algebra.md#in) |
| `index` | selection | Selects atoms by 1-based object-local atom index (idx.), supporting ranges. | implemented | [doc](features/topics/selection-algebra.md#index) |
| `inorganic` | selection | Inorganic groups: ions and other non-carbon non-polymer atoms (ino.). | unknown | [doc](features/topics/selection-algebra.md#inorganic) |
| `label` | selection | Atoms carrying a rendered label whose string matches a value. | unknown | [doc](features/topics/selection-algebra.md#label) |
| `last` | selection | The single highest-index atom of the operand (last in table order). | implemented | [doc](features/topics/selection-algebra.md#last) |
| `like` | selection | Keeps atoms of A matching B by name and numeric identifiers only (l.). | unknown | [doc](features/topics/selection-algebra.md#like) |
| `masked` | selection | Atoms with the mask flag set, protected from picking/editing (msk.). | unknown | [doc](features/topics/selection-algebra.md#masked) |
| `metals` | selection | Atoms whose element is a metal. | implemented | [doc](features/topics/selection-algebra.md#metals) |
| `name` | selection | Selects atoms by atom name (n.), supporting +-lists and glob wildcards. | implemented | [doc](features/topics/selection-algebra.md#name) |
| `named-selections` | selection | A bare token resolves to a stored named selection (%name) or an object name (model/m.). | implemented | [doc](features/topics/selection-algebra.md#named-selections) |
| `near_to` | selection | Atoms of A within a distance of B, excluding B itself (nto.). | implemented | [doc](features/topics/selection-algebra.md#near_to) |
| `neighbor` | selection | Atoms directly bonded to the selection, excluding it (nbr.). | implemented | [doc](features/topics/selection-algebra.md#neighbor) |
| `none` | selection | The empty set of atoms. | implemented | [doc](features/topics/selection-algebra.md#none) |
| `not` | selection | Unary complement of an operand (!). | implemented | [doc](features/topics/selection-algebra.md#not) |
| `numeric_type` | selection | Selects atoms by integer numeric (atom) type (nt.). | implemented | [doc](features/topics/selection-algebra.md#numeric_type) |
| `or` | selection | Set union of two operands (\| / +). | implemented | [doc](features/topics/selection-algebra.md#or) |
| `organic` | selection | Small organic (ligand) molecules (org.). | unknown | [doc](features/topics/selection-algebra.md#organic) |
| `origin` | selection | A pseudo-atom at the current rotation origin, for distance queries. | unknown | [doc](features/topics/selection-algebra.md#origin) |
| `partial_charge` | selection | Numeric comparison on floating-point partial charge (pc.). | implemented | [doc](features/topics/selection-algebra.md#partial_charge) |
| `pepseq` | selection | Residues whose one-letter protein sequence matches a regular-expression motif (ps.). | implemented | [doc](features/topics/selection-algebra.md#pepseq) |
| `polymer` | selection | Biopolymer (protein/nucleic) atoms, excluding solvent and heteroatoms (pol.). | implemented | [doc](features/topics/selection-algebra.md#polymer) |
| `polymer.nucleic` | selection | Nucleic-acid subset of polymer (nucleic/nuc.). | unknown | [doc](features/topics/selection-algebra.md#polymernucleic) |
| `polymer.protein` | selection | Protein subset of polymer (protein/pro.). | unknown | [doc](features/topics/selection-algebra.md#polymerprotein) |
| `present` | selection | Atoms that have coordinates in the current/requested state (pr.). | implemented | [doc](features/topics/selection-algebra.md#present) |
| `property` | selection | Numeric/string comparison on a user-defined per-atom property in the p. namespace. | unknown | [doc](features/topics/selection-algebra.md#property) |
| `protected` | selection | Atoms with the protect flag set, excluded from sculpting/movement. | unknown | [doc](features/topics/selection-algebra.md#protected) |
| `q` | selection | Numeric comparison on the occupancy column. | implemented | [doc](features/topics/selection-algebra.md#q) |
| `rank` | selection | Selects atoms by original load-order rank, supporting ranges. | unknown | [doc](features/topics/selection-algebra.md#rank) |
| `rep` | selection | Atoms for which a named representation is currently shown (rep <name>). | implemented | [doc](features/topics/selection-algebra.md#rep) |
| `resi` | selection | Selects atoms by residue identifier (i./residue), supporting +-lists and numeric ranges. | implemented | [doc](features/topics/selection-algebra.md#resi) |
| `resi-ranges` | selection | Inclusive numeric ranges lo-hi for resi/index/id/rank, combinable with +-lists. | implemented | [doc](features/topics/selection-algebra.md#resi-ranges) |
| `resn` | selection | Selects atoms by residue (compound) name (r./resname). | implemented | [doc](features/topics/selection-algebra.md#resn) |
| `restrained` | selection | Atoms carrying the restrain flag (flag 2), tethered to reference coords (rst.). | unknown | [doc](features/topics/selection-algebra.md#restrained) |
| `ribbon_color` | selection | Atoms whose per-atom ribbon_color setting equals a colour index or name. | unknown | [doc](features/topics/selection-algebra.md#ribbon_color) |
| `segi` | selection | Selects atoms by segment identifier (s./segid/segment). | implemented | [doc](features/topics/selection-algebra.md#segi) |
| `sidechain` | selection | Polymer non-backbone (side chain) atoms (sc.). | implemented | [doc](features/topics/selection-algebra.md#sidechain) |
| `slash-macro` | selection | Positional /object/segi/chain/resi/name shorthand ANDing the present fields. | implemented | [doc](features/topics/selection-algebra.md#slash-macro) |
| `solvent` | selection | Solvent atoms, primarily water (sol.). | implemented | [doc](features/topics/selection-algebra.md#solvent) |
| `ss` | selection | Selects atoms by secondary-structure type H/S/L. | implemented | [doc](features/topics/selection-algebra.md#ss) |
| `state` | selection | Selects atoms belonging to a given object state. | implemented | [doc](features/topics/selection-algebra.md#state) |
| `stereo` | selection | Selects atoms by R/S chirality label. | unknown | [doc](features/topics/selection-algebra.md#stereo) |
| `text_type` | selection | Selects atoms by MOL2/Tripos text (atom) type (tt.). | implemented | [doc](features/topics/selection-algebra.md#text_type) |
| `visible` | selection | Atoms with at least one representation currently shown (v.). | implemented | [doc](features/topics/selection-algebra.md#visible) |
| `wildcards` | selection | Glob wildcards */? in text property value specs, case-insensitive. | implemented | [doc](features/topics/selection-algebra.md#wildcards) |
| `within` | selection | Atoms of A within a distance of any atom of B (w.). | implemented | [doc](features/topics/selection-algebra.md#within) |

## settings (723)

| Feature | Kind | Summary | Parity | Doc |
| --- | --- | --- | --- | --- |
| `get` `get(name, selection='', state=0, quiet=1)` | command | Prints and returns the current value of a global, per-object, or per-state setting. | implemented | [doc](features/commands/get.md) |
| `get_bond` `get_bond(name, selection1, selection2=None, state=0, updates=1, quiet=1)` | command | Returns per-bond setting values for all bonds between two atom selections. | implemented | [doc](features/commands/get_bond.md) |
| `get_setting_boolean` `get_setting_boolean(name, object='', state=0)` | command | Read a single setting's value coerced to a Python boolean. | implemented | [doc](features/commands/get_setting_boolean.md) |
| `get_setting_float` `get_setting_float(name, object='', state=0)` | command | Read a single setting's value coerced to a Python float. | implemented | [doc](features/commands/get_setting_float.md) |
| `get_setting_int` `get_setting_int(name, object='', state=0)` | command | Read a single setting's value coerced to a Python int. | implemented | [doc](features/commands/get_setting_int.md) |
| `get_setting_legacy` `get_setting_legacy(name, object='', state=0)` | command | Legacy alias of get_setting_float that reads a setting as a float. | implemented | [doc](features/commands/get_setting_legacy.md) |
| `get_setting_text` `get_setting_text(name, object='', state=0)` | command | Read a single setting's value coerced to a text/string form. | internal | [doc](features/commands/get_setting_text.md) |
| `get_setting_tuple` `get_setting_tuple(name, object='', state=0)` | command | Read a setting as a (type, value) tuple with legacy value packaging. | internal | [doc](features/commands/get_setting_tuple.md) |
| `get_setting_updates` `get_setting_updates(object='', state=0)` | command | Return the list of setting indices changed since the last poll. | internal | [doc](features/commands/get_setting_updates.md) |
| `help_setting` `help_setting(name, quiet=1)` | command | Prints documentation for a named setting. | partial | [doc](features/commands/help_setting.md) |
| `set` `set(name, value=1, selection='', state=0, updates=1, log=0, quiet=1)` | command | Changes a global, per-object, per-object-state, or per-atom setting. | implemented | [doc](features/commands/set.md) |
| `unset` `unset(name, selection='', state=0, updates=1, log=0, quiet=1)` | command | Clears a setting and restores its default value (global or per-object/state/atom). | implemented | [doc](features/commands/unset.md) |
| `unset_bond` `unset_bond(name, selection1, selection2=None, state=0, updates=1, log=0, quiet=1)` | command | Removes a per-bond setting for the bonds between two atom selections. | implemented | [doc](features/commands/unset_bond.md) |
| `unset_deep` `unset_deep(settings='', object='*', updates=1, quiet=1)` | command | Unsets all object, object-state, atom, and bond level settings across objects. | partial | [doc](features/commands/unset_deep.md) |
| `active_selections` | setting | controls whether or not PyMOL relies upon the concept of an active selection. | unknown | [doc](features/settings/_batch-00.md#selections-active-selections) |
| `alignment_as_cylinders` | setting | If true, distance measure dashes are drawn as high-quality cylinders instead of lines. | unknown | [doc](features/settings/_batch-00.md#alignment-alignment-as-cylinders) |
| `all_states` | setting | controls whether or not all molecular states are visible. | unknown | [doc](features/settings/_batch-00.md#object-states-all-states) |
| `ambient` | setting | (float 0.0-1.0, default: 0.14) controls the ambient lighting level. | unknown | [doc](features/settings/_batch-00.md#lighting-ambient-direct) |
| `ambient_occlusion_mode` | setting | Controls which method is used to draw ambient occlusion. 0=disabled, 1=atom-based occlusion, 2=triangle-based occlusion | unknown | [doc](features/settings/_batch-00.md#lighting-ambient-direct) |
| `ambient_occlusion_scale` | setting | The scale by which ambient occlusion values are modified. The larger this value the more hinting is applied. | unknown | [doc](features/settings/_batch-00.md#lighting-ambient-direct) |
| `ambient_occlusion_smooth` | setting | Controls whether or not ambient occlusion uses smoothing of nearby values. | unknown | [doc](features/settings/_batch-00.md#lighting-ambient-direct) |
| `anaglyph_mode` | setting | implements the following 4 anaglyph modes (see also Anaglyph stereo mode settings) 0 = true anaglyph 1 = gray 2 = color 3 = half-color 4 = optimized (default) | unknown | [doc](features/settings/_batch-00.md#stereo-depth-anaglyph-mode-chromadepth-depth-cue) |
| `angle_color` | setting | Controls the coloring of angle measures. | unknown | [doc](features/settings/_batch-00.md#measurement-labels-angle-dihedral-dist-distance-dynamic-measures) |
| `angle_label_position` | setting | (float: >0.0, default: 0.5) controls where the angle label is drawn. | unknown | [doc](features/settings/_batch-00.md#measurement-labels-angle-dihedral-dist-distance-dynamic-measures) |
| `angle_size` | setting | (float: >0.0, default: 0.6666) controls how far out the angle indicator is drawn. | unknown | [doc](features/settings/_batch-00.md#measurement-labels-angle-dihedral-dist-distance-dynamic-measures) |
| `animation` | setting | controls whether or not the camera is smoothly interpolated between views. | unknown | [doc](features/settings/_batch-00.md#animation-animation) |
| `animation_duration` | setting | controls the default duration of animation for changes in view (note: scene_animation_duration controls the timing of scene transitions. | unknown | [doc](features/settings/_batch-00.md#animation-animation) |
| `antialias` | setting | (integer 0-4, default: 1) general settings for controlling antialiasing. 0 = no antialiasing 1 = adaptive antialiasing 2 = 2-times uniform oversampling plus adaptive antialiasing 3 = 3-times unifor... | implemented | [doc](features/settings/_batch-00.md#rendering-antialiasing-antialias-backface-cull-draw-ati-bugs) |
| `antialias_shader` | setting | Real-time (shader) antialiasing: 0 none, 1 FXAA, 2 SMAA. | unknown | [doc](features/settings/_batch-00.md#rendering-antialiasing-antialias-backface-cull-draw-ati-bugs) |
| `async_builds` | setting | controls whether or not geometry builds should be performed in parallel on multithreaded machines. WARNING: This setting can create instability and should be used with caution. | unknown | [doc](features/settings/_batch-00.md#performance-deferred-builds-cache-async-builds-defer-cache) |
| `ati_bugs` | setting | Controls whether or not PyMOL adapts its rendering to avoid known ATI bugs. | unknown | [doc](features/settings/_batch-00.md#rendering-antialiasing-antialias-backface-cull-draw-ati-bugs) |
| `atom_name_wildcard` | setting | controls the wildcard character used when matching atom names. If this string is empty, then the normal wildcard setting will be used. The practical purpose of this setting is to disable use of ast... | unknown | [doc](features/settings/_batch-00.md#atom-naming-typing-atom) |
| `atom_type_format` | setting | Sets the label format for label types. Supported options are: mol2, sybyl, macromodel, mmd, sdf. mol2 sybyl (synonym for mol2) macromodel mmd (synonym for macromodel) sdf (default) | unknown | [doc](features/settings/_batch-00.md#atom-naming-typing-atom) |
| `auto_classify_atoms` | setting | controls whether or not PyMOL spends extra CPU cycles classifying atoms as polymer, organic, solvent, or inorganic as well as locating per-residue guide atoms. | unknown | [doc](features/settings/_batch-00.md#automatic-behaviours-auto-autoclose-dialogs) |
| `auto_color` | setting | controls whether or not new objects are given a different color for their carbon atoms. | unknown | [doc](features/settings/_batch-00.md#automatic-behaviours-auto-autoclose-dialogs) |
| `auto_color_next` | setting | Index of the next auto color to be assigned by auto_color. | unknown | [doc](features/settings/_batch-00.md#automatic-behaviours-auto-autoclose-dialogs) |
| `auto_copy_images` | setting | controls whether or not PyMOL automatically copies images from the OpenGL viewport into the system's clipboard. | unknown | [doc](features/settings/_batch-00.md#automatic-behaviours-auto-autoclose-dialogs) |
| `auto_defer_atom_count` | setting | Structures with fewer than ''auto_defer_atom_count'' atoms are automatically labeled upon loading. Set to 0 to auto label none. | unknown | [doc](features/settings/_batch-00.md#automatic-behaviours-auto-autoclose-dialogs) |
| `auto_defer_builds` | setting | Multistate models with fewer than ''auto_defer_builds'' number of states will automatically be preprocessed for geometry and rendering. Set to -1 to process all states regardless of count. | unknown | [doc](features/settings/_batch-00.md#performance-deferred-builds-cache-async-builds-defer-cache) |
| `auto_dss` | setting | controls whether or not secondary structure is automatically computed for structure which lack such definitions. | unknown | [doc](features/settings/_batch-00.md#automatic-behaviours-auto-autoclose-dialogs) |
| `auto_hide_selections` | setting | controls whether or not PyMOL automatically disables selections when new objects or selections are created. | unknown | [doc](features/settings/_batch-00.md#automatic-behaviours-auto-autoclose-dialogs) |
| `auto_indicate_flags` | setting | controls whether or not PyMOL automatically indicates flagged atoms when the \flag\" command is issue." | unknown | [doc](features/settings/_batch-00.md#automatic-behaviours-auto-autoclose-dialogs) |
| `auto_number_selections` | setting | controls whether PyMOL gives each new unnamed selection a unique name or whether it simply uses \sele\"." | unknown | [doc](features/settings/_batch-00.md#automatic-behaviours-auto-autoclose-dialogs) |
| `auto_overlay` | setting | controls whether or not overlay text is automatically shown/hidden in response to user actions. | unknown | [doc](features/settings/_batch-00.md#automatic-behaviours-auto-autoclose-dialogs) |
| `auto_remove_hydrogens` | setting | controls whether or not hydrogens are automatically removed when building. | unknown | [doc](features/settings/_batch-00.md#automatic-behaviours-auto-autoclose-dialogs) |
| `auto_rename_duplicate_objects` | setting | if on, PyMOL will rename new objects that have the same name as an existing object; if off, PyMOL will overwrite the existing object. | unknown | [doc](features/settings/_batch-00.md#automatic-behaviours-auto-autoclose-dialogs) |
| `auto_sculpt` | setting | controls whether or not sculpting is automatically activated when an atom is moved. | unknown | [doc](features/settings/_batch-00.md#automatic-behaviours-auto-autoclose-dialogs) |
| `auto_show_classified` | setting | How newly classified atoms are shown: -1 auto, 0 off, 1 as, 2 show, 3 simple. | unknown | [doc](features/settings/_batch-00.md#automatic-behaviours-auto-autoclose-dialogs) |
| `auto_show_lines` | setting | controls whether or not the lines representation is automatically shown for new objects. | unknown | [doc](features/settings/_batch-00.md#automatic-behaviours-auto-autoclose-dialogs) |
| `auto_show_nonbonded` | setting | control whether or not the nonbonded representation is automatically shown for new objects. | unknown | [doc](features/settings/_batch-00.md#automatic-behaviours-auto-autoclose-dialogs) |
| `auto_show_selections` | setting | controls whether or not PyMOL automatically enables each new selection. | unknown | [doc](features/settings/_batch-00.md#automatic-behaviours-auto-autoclose-dialogs) |
| `auto_show_spheres` | setting | controls whether or not the sphere representation is automatically shown for new objects. | unknown | [doc](features/settings/_batch-00.md#automatic-behaviours-auto-autoclose-dialogs) |
| `auto_zoom` | setting | controls automatic zooming behavior: 0 = no zoom 1 = zoom new objects 2 = zoom always 3 = zoom current state always 4 = zoom all objects 5 = zoom first object only | unknown | [doc](features/settings/_batch-00.md#automatic-behaviours-auto-autoclose-dialogs) |
| `autoclose_dialogs` | setting | Unused setting. | unknown | [doc](features/settings/_batch-00.md#automatic-behaviours-auto-autoclose-dialogs) |
| `backface_cull` | setting | controls whether or not the raytracer renders backfacing triangles. | unknown | [doc](features/settings/_batch-00.md#rendering-antialiasing-antialias-backface-cull-draw-ati-bugs) |
| `batch_prefix` | setting | contains a prefix to be used for temporary files. | unknown | [doc](features/settings/_batch-00.md#system-gui-batch-prefix-debug-pick-colored-feedback-display-scale-factor) |
| `bg_gradient` | setting | Controls whether or not the background is gradient colored. If yes, then bg_rgb_top and bg_rgb_bottom will be used to set the colors. | unknown | [doc](features/settings/_batch-00.md#background-bg) |
| `bg_image_filename` | setting | if set controls the image used in the background. | unknown | [doc](features/settings/_batch-00.md#background-bg) |
| `bg_image_linear` | setting | controls the sampling of the texture for the background image. If off, then the nearest pixel is set, otherwise, a linear interpolation is used. | unknown | [doc](features/settings/_batch-00.md#background-bg) |
| `bg_image_mode` | setting | Determines how the background image is drawn. 0 - stretched, 1 - centered, 2 - tiled, 3 - centered and repeated | unknown | [doc](features/settings/_batch-00.md#background-bg) |
| `bg_image_tilesize` | setting | This setting is used when bg_image_mode=3 and defines the size of each tile (in x and y, z is not used). | unknown | [doc](features/settings/_batch-00.md#background-bg) |
| `bg_rgb` | setting | controls the background rgb color. | implemented | [doc](features/settings/_batch-00.md#background-bg) |
| `bg_rgb_bottom` | setting | Controls bottom color when bg_gradient is set. | unknown | [doc](features/settings/_batch-00.md#background-bg) |
| `bg_rgb_top` | setting | Controls top color when bg_grdient is set. | unknown | [doc](features/settings/_batch-00.md#background-bg) |
| `button_mode` | setting | reports the current button mode index (internal). | implemented | [doc](features/settings/_batch-00.md#mouse-button-mode-button-mode) |
| `button_mode_name` | setting | reports the current button mode name. | implemented | [doc](features/settings/_batch-00.md#mouse-button-mode-button-mode) |
| `cache_display` | setting | controls whether or not a copy is made of the current display in order to speed updates of menus, etc. | unknown | [doc](features/settings/_batch-00.md#performance-deferred-builds-cache-async-builds-defer-cache) |
| `cache_frames` | setting | controls whether or not each movie frame will be stored in RAM and then replayed from memory. This is used for previewing a movie at a higher frame rate. The \mclear\" command can be used to flush ... | unknown | [doc](features/settings/_batch-00.md#performance-deferred-builds-cache-async-builds-defer-cache) |
| `cache_max` | setting | controls how many primitive data elements can be retained in the geometry cache (before old/unused entries are expired). | unknown | [doc](features/settings/_batch-00.md#performance-deferred-builds-cache-async-builds-defer-cache) |
| `cache_memory` | setting | special case, currently unsupported setting. | unknown | [doc](features/settings/_batch-00.md#performance-deferred-builds-cache-async-builds-defer-cache) |
| `cache_mode` | setting | (integer: 0-2, default 0) controls whether or not PyMOL retains precomputed geometries (such as molecular surfaces) inside the session file. 0: off 1: read only 2: retain all new surfaces computed | unknown | [doc](features/settings/_batch-00.md#performance-deferred-builds-cache-async-builds-defer-cache) |
| `cartoon_all_alt` | setting | If on, cartoon is drawn through all alternate-location atoms rather than just the primary altloc. | unknown | [doc](features/settings/_batch-00.md#cartoon-representation-cartoon) |
| `cartoon_color` | setting | (color, default:-1) controls the color of the cartoon representation. | unknown | [doc](features/settings/_batch-00.md#cartoon-representation-cartoon) |
| `cartoon_cylindrical_helices` | setting | controls whether helices are displayed as cylinders or as a residue-based cartoon. | unknown | [doc](features/settings/_batch-00.md#cartoon-representation-cartoon) |
| `cartoon_debug` | setting | (integer: 0-3, default: 0) is for development. | unknown | [doc](features/settings/_batch-00.md#cartoon-representation-cartoon) |
| `cartoon_discrete_colors` | setting | affects whether per-residue colors change at or halfway inbetween the C-alpha position. | unknown | [doc](features/settings/_batch-00.md#cartoon-representation-cartoon) |
| `cartoon_dumbbell_length` | setting | is a parameter for the dumbbell cross-section. | unknown | [doc](features/settings/_batch-00.md#cartoon-representation-cartoon) |
| `cartoon_dumbbell_radius` | setting | is a parameter for the dumbbell cross-section. | unknown | [doc](features/settings/_batch-00.md#cartoon-representation-cartoon) |
| `cartoon_dumbbell_width` | setting | is a parameter for the dumbbell cross-section. | unknown | [doc](features/settings/_batch-00.md#cartoon-representation-cartoon) |
| `cartoon_fancy_helices` | setting | controls whether dumbbell or oval cross-section is used. | implemented | [doc](features/settings/_batch-00.md#cartoon-representation-cartoon) |
| `cartoon_fancy_sheets` | setting | controls whether or not beta-sheet strands have arrows. | unknown | [doc](features/settings/_batch-00.md#cartoon-representation-cartoon) |
| `cartoon_flat_cycles` | setting | is the number of cycles of \flattening\" applied to beta-sheets when cartoon_flat_sheets is on." | implemented | [doc](features/settings/_batch-00.md#cartoon-representation-cartoon) |
| `cartoon_flat_sheets` | setting | controls whether or not beta-sheet strands are flattened. | implemented | [doc](features/settings/_batch-00.md#cartoon-representation-cartoon) |
| `cartoon_gap_cutoff` | setting | cutoff for drawing a dashed cartoon loop across gaps. E.g. if one residue is missing, the cutoff needs to be >=2 (or for 5 missing residues, >= 6, etc.). | unknown | [doc](features/settings/_batch-00.md#cartoon-representation-cartoon) |
| `cartoon_helix_radius` | setting | controls the radius of the cylindrical helix representation. | unknown | [doc](features/settings/_batch-00.md#cartoon-representation-cartoon) |
| `cartoon_highlight_color` | setting | controls the accent color. | implemented | [doc](features/settings/_batch-00.md#cartoon-representation-cartoon) |
| `cartoon_ladder_color` | setting | controls the color of the ladder representation. | unknown | [doc](features/settings/_batch-00.md#cartoon-representation-cartoon) |
| `cartoon_ladder_mode` | setting | controls how the ladder is drawn. | unknown | [doc](features/settings/_batch-00.md#cartoon-representation-cartoon) |
| `cartoon_ladder_radius` | setting | controls the radius of the ladder representation. | unknown | [doc](features/settings/_batch-00.md#cartoon-representation-cartoon) |
| `cartoon_loop_cap` | setting | (integer: 0-2, default: 1) controls how loop segments are capped: 0 = not capped 1 = round cap 2 = flat cap | unknown | [doc](features/settings/_batch-00.md#cartoon-representation-cartoon) |
| `cartoon_loop_quality` | setting | controls how many facets are used to draw the loop cross-section. | unknown | [doc](features/settings/_batch-00.md#cartoon-representation-cartoon) |
| `cartoon_loop_radius` | setting | controls the radius of loop segments. | implemented | [doc](features/settings/_batch-00.md#cartoon-representation-cartoon) |
| `cartoon_nucleic_acid_as_cylinders` | setting | controls whether or not PyMOL draws cartoon nucleic acids as high-quality cylinders or low-quality. | unknown | [doc](features/settings/_batch-00.md#cartoon-representation-cartoon) |
| `cartoon_nucleic_acid_color` | setting | controls the control of nucleic acid backbone cartoons. | unknown | [doc](features/settings/_batch-00.md#cartoon-representation-cartoon) |
| `cartoon_nucleic_acid_mode` | setting | controls how the nucleic acid backbone is computed: 0 = use P coordinates 1 = use C1* coordinates 2 = use P coordinates and terminal 3' OH (if present) 3 = use P coordinates and terminal 5' OH (if ... | unknown | [doc](features/settings/_batch-00.md#cartoon-representation-cartoon) |
| `cartoon_oval_length` | setting | is the length of the oval cross-section. | unknown | [doc](features/settings/_batch-00.md#cartoon-representation-cartoon) |
| `cartoon_oval_quality` | setting | controls how many facets are used to draw the oval cross-section. | unknown | [doc](features/settings/_batch-00.md#cartoon-representation-cartoon) |
| `cartoon_oval_width` | setting | is the width of the oval cross section. | unknown | [doc](features/settings/_batch-00.md#cartoon-representation-cartoon) |
| `cartoon_power` | setting | affects cartoon shape. | unknown | [doc](features/settings/_batch-00.md#cartoon-representation-cartoon) |
| `cartoon_power_b` | setting | affects cartoon shape. | unknown | [doc](features/settings/_batch-00.md#cartoon-representation-cartoon) |
| `cartoon_putty_quality` | setting | controls how many facets are used. | unknown | [doc](features/settings/_batch-00.md#cartoon-representation-cartoon) |
| `cartoon_putty_radius` | setting | is the default putty size. | unknown | [doc](features/settings/_batch-00.md#cartoon-representation-cartoon) |
| `cartoon_putty_range` | setting | is a putty scaling parameter. | unknown | [doc](features/settings/_batch-00.md#cartoon-representation-cartoon) |
| `cartoon_putty_scale_max` | setting | is a putty scaling parameter. | unknown | [doc](features/settings/_batch-00.md#cartoon-representation-cartoon) |
| `cartoon_putty_scale_min` | setting | is a putty scaling parameter. | unknown | [doc](features/settings/_batch-00.md#cartoon-representation-cartoon) |
| `cartoon_putty_scale_power` | setting | is a putty scaling parameter. | unknown | [doc](features/settings/_batch-00.md#cartoon-representation-cartoon) |
| `cartoon_putty_transform` | setting | 0 is normalized nonlinear scaling; 1 is relative nonlinear scaling; 2 is scaled nonlinear scaling; 3 is absolute nonlinear scaling; 4 is normalized linear scaling; 5 is relative linear scaling; 6 i... | unknown | [doc](features/settings/_batch-00.md#cartoon-representation-cartoon) |
| `cartoon_rect_length` | setting | is the length of the rectangle cross-section. | unknown | [doc](features/settings/_batch-00.md#cartoon-representation-cartoon) |
| `cartoon_rect_width` | setting | is the width of the rectangle cross-section. | unknown | [doc](features/settings/_batch-00.md#cartoon-representation-cartoon) |
| `cartoon_refine` | setting | controls how much refinement is done of intermediate cartoon coordinates. | unknown | [doc](features/settings/_batch-00.md#cartoon-representation-cartoon) |
| `cartoon_refine_normals` | setting | controls whether or not normals are refined (-1 = automatic). | unknown | [doc](features/settings/_batch-00.md#cartoon-representation-cartoon) |
| `cartoon_refine_tips` | setting | controls how much the tips of beta-strands are refined (straightened). | implemented | [doc](features/settings/_batch-00.md#cartoon-representation-cartoon) |
| `cartoon_ring_color` | setting | controls the color of ring representation. | unknown | [doc](features/settings/_batch-00.md#cartoon-representation-cartoon) |
| `cartoon_ring_finder` | setting | Which rings the cartoon ring finder detects: 1 bases+sugars, 2 bases only, 3 non-protein rings, 4 all rings. | unknown | [doc](features/settings/_batch-00.md#cartoon-representation-cartoon) |
| `cartoon_ring_mode` | setting | controls how rings are shown: 0 = no ring (use ladders for bases, if applicable) 1 = round-edge rings 2 = square-edge rings 3 = rings with edges 4 = show ring as a sphere of approximate size 5 = sh... | unknown | [doc](features/settings/_batch-00.md#cartoon-representation-cartoon) |
| `cartoon_ring_radius` | setting | controls the radius of the sphere used to represent rings (-1.0 means compute from ring geometry). | unknown | [doc](features/settings/_batch-00.md#cartoon-representation-cartoon) |
| `cartoon_ring_transparency` | setting | controls the transparency level of rings. When negative, this setting is controlled by cartoon_transparency. | unknown | [doc](features/settings/_batch-00.md#cartoon-representation-cartoon) |
| `cartoon_ring_width` | setting | controls the thickness of the ring representation. | unknown | [doc](features/settings/_batch-00.md#cartoon-representation-cartoon) |
| `cartoon_round_helices` | setting | controls whether or not PyMOL makes helices round by forcing orientation vectors to point along the helix axes. | unknown | [doc](features/settings/_batch-00.md#cartoon-representation-cartoon) |
| `cartoon_sampling` | setting | controls how many facets are used to draw cartoon segments. | unknown | [doc](features/settings/_batch-00.md#cartoon-representation-cartoon) |
| `cartoon_side_chain_helper` | setting | controls whether or not PyMOL will hide backbone lines and sticks when the cartoon representation is visible as well as disabling smoothing for C-alpha coordinates for residues whose side chains ar... | implemented | [doc](features/settings/_batch-00.md#cartoon-representation-cartoon) |
| `cartoon_smooth_cycles` | setting | controls how many smoothing cycles are applied to the overall cartoon. | unknown | [doc](features/settings/_batch-00.md#cartoon-representation-cartoon) |
| `cartoon_smooth_cylinder_cycles` | setting | Number of smoothing passes applied to cylindrical (helix) cartoon axes. | unknown | [doc](features/settings/_batch-00.md#cartoon-representation-cartoon) |
| `cartoon_smooth_cylinder_window` | setting | Window size used when smoothing cylindrical (helix) cartoon axes. | unknown | [doc](features/settings/_batch-00.md#cartoon-representation-cartoon) |
| `cartoon_smooth_first` | setting | (integer, default: 1) controls the start point for smoothing each segment. | unknown | [doc](features/settings/_batch-00.md#cartoon-representation-cartoon) |
| `cartoon_smooth_last` | setting | controls the stop point for smoothing of each segment. | unknown | [doc](features/settings/_batch-00.md#cartoon-representation-cartoon) |
| `cartoon_smooth_loops` | setting | controls whether or not loop segments are smoothed. Note that this setting modifies the apparent coordinates of the loop in order to achieve improved aesthetics. | implemented | [doc](features/settings/_batch-00.md#cartoon-representation-cartoon) |
| `cartoon_throw` | setting | affects cartoon geometry. | unknown | [doc](features/settings/_batch-00.md#cartoon-representation-cartoon) |
| `cartoon_trace_atoms` | setting | controls whether cartoons are traced through all atoms. Note that this setting only works well for the loop and tube representations. | unknown | [doc](features/settings/_batch-00.md#cartoon-representation-cartoon) |
| `cartoon_transparency` | setting | controls the transparency of cartoon representations. | unknown | [doc](features/settings/_batch-00.md#cartoon-representation-cartoon) |
| `cartoon_tube_cap` | setting | controls the type of cap applied to the tube, and accepts the same values as cartoon_loop_cap. | unknown | [doc](features/settings/_batch-00.md#cartoon-representation-cartoon) |
| `cartoon_tube_quality` | setting | controls how many facets are used in the tube cross-section. | unknown | [doc](features/settings/_batch-00.md#cartoon-representation-cartoon) |
| `cartoon_tube_radius` | setting | controls the radius of tube segments. | unknown | [doc](features/settings/_batch-00.md#cartoon-representation-cartoon) |
| `cartoon_use_shader` | setting | If true, on screen rendering of cartoons uses the OpenGL shader language (GLSL) to render cartoon. If false, OpenGL v1.x style rendering is used. | unknown | [doc](features/settings/_batch-00.md#cartoon-representation-cartoon) |
| `cavity_cull` | setting | is the threshold below which isolated clusters of points will be excluded from the surface representation. These are generally interior pockets inside of proteins. | unknown | [doc](features/settings/_batch-00.md#surface-cavity-cull-dot-solvent) |
| `cgo_debug` | setting | Controls whether or not PyMOL shows debugging graphics related to CGO objects. | unknown | [doc](features/settings/_batch-00.md#cgo-procedural-geometry-cgo-cone-quality) |
| `cgo_dot_radius` | setting | if greater than zero, controls the default radius for cgo dots when ray tracing. Otherwise, the radius is computed from cgo_dot_width. | unknown | [doc](features/settings/_batch-00.md#cgo-procedural-geometry-cgo-cone-quality) |
| `cgo_dot_width` | setting | controls the width of cgo dots. | unknown | [doc](features/settings/_batch-00.md#cgo-procedural-geometry-cgo-cone-quality) |
| `cgo_ellipsoid_quality` | setting | Controls cgo-based representation quality of ellipsoids. | unknown | [doc](features/settings/_batch-00.md#cgo-procedural-geometry-cgo-cone-quality) |
| `cgo_lighting` | setting | controls whether or not PyMOL lights CGOs. | unknown | [doc](features/settings/_batch-00.md#cgo-procedural-geometry-cgo-cone-quality) |
| `cgo_line_radius` | setting | if greater than zero, controls the default radius for lines when ray tracing. Otherwise, the radius is computed from cgo_line_width; | unknown | [doc](features/settings/_batch-00.md#cgo-procedural-geometry-cgo-cone-quality) |
| `cgo_line_width` | setting | is the default line width for cgo geometries. | unknown | [doc](features/settings/_batch-00.md#cgo-procedural-geometry-cgo-cone-quality) |
| `cgo_ray_width_scale` | setting | Scale applied to CGO line widths when ray tracing (negative = pixel-width fallback). | unknown | [doc](features/settings/_batch-00.md#cgo-procedural-geometry-cgo-cone-quality) |
| `cgo_shader_ub_color` | setting | controls the data size of color data sent to the graphics card. If enabled, unsigned bytes are sent which may be faster and smaller. | unknown | [doc](features/settings/_batch-00.md#cgo-procedural-geometry-cgo-cone-quality) |
| `cgo_shader_ub_flags` | setting | controls whether or not unsigned bytes are used in sending data to the graphics card. | unknown | [doc](features/settings/_batch-00.md#cgo-procedural-geometry-cgo-cone-quality) |
| `cgo_shader_ub_normal` | setting | controls the data size of normals sent to the graphics card. If enabled, unsigned bytes are sent which may be faster and smaller. | unknown | [doc](features/settings/_batch-00.md#cgo-procedural-geometry-cgo-cone-quality) |
| `cgo_sphere_quality` | setting | controls the sphere quality to use when loading CGO representations. | unknown | [doc](features/settings/_batch-00.md#cgo-procedural-geometry-cgo-cone-quality) |
| `cgo_transparency` | setting | controls the default transparency of cgo geometries. | unknown | [doc](features/settings/_batch-00.md#cgo-procedural-geometry-cgo-cone-quality) |
| `cgo_use_shader` | setting | If true, on screen rendering of CGOs uses the OpenGL shader language (GLSL). If false, OpenGL v1.x style rendering is used. | unknown | [doc](features/settings/_batch-00.md#cgo-procedural-geometry-cgo-cone-quality) |
| `chem_comp_cartn_use` | setting | For mmCIF chem_comp: which Cartesian coordinate columns to use. | unknown | [doc](features/settings/_batch-00.md#file-i-o-mmcif-assembly-cif-chem-comp-cartn-use) |
| `chromadepth` | setting | Enables ChromaDepth stereo encoding (color-coded depth) when non-zero. | unknown | [doc](features/settings/_batch-00.md#stereo-depth-anaglyph-mode-chromadepth-depth-cue) |
| `cif_keepinmemory` | setting | Experimental feature. Retain parsed CIF file in memory, for pymol.querying.cif_get_array | unknown | [doc](features/settings/_batch-00.md#file-i-o-mmcif-assembly-cif-chem-comp-cartn-use) |
| `cif_metalc_as_zero_order_bonds` | setting | If on, metal-coordination records in mmCIF are imported as zero-order bonds. | unknown | [doc](features/settings/_batch-00.md#file-i-o-mmcif-assembly-cif-chem-comp-cartn-use) |
| `cif_use_auth` | setting | When loading mmCIF files, use 'auth_*' identifiers (if present, fallback to 'label_*' identifiers). Note that 'label_asym_id' is always loaded as the 'segi' identifier (if present). | unknown | [doc](features/settings/_batch-00.md#file-i-o-mmcif-assembly-cif-chem-comp-cartn-use) |
| `clamp_colors` | setting | controls whether or not colors are clamped to the current color table. | unknown | [doc](features/settings/_batch-00.md#coloring-clamp-colors) |
| `collada_background_box` | setting | If on, a background box is included in exported COLLADA (.dae) scenes. | unknown | [doc](features/settings/_batch-00.md#export-collada-collada) |
| `collada_export_lighting` | setting | If non-zero, light sources are written into exported COLLADA scenes. | unknown | [doc](features/settings/_batch-00.md#export-collada-collada) |
| `collada_geometry_mode` | setting | Geometry granularity/mode used when exporting COLLADA. | unknown | [doc](features/settings/_batch-00.md#export-collada-collada) |
| `colored_feedback` | setting | If on, console/feedback text is colorized. | unknown | [doc](features/settings/_batch-00.md#system-gui-batch-prefix-debug-pick-colored-feedback-display-scale-factor) |
| `cone_quality` | setting | controls the number of segments used to draw CGO cones. | unknown | [doc](features/settings/_batch-00.md#cgo-procedural-geometry-cgo-cone-quality) |
| `connect_bonded` | setting | controls whether or not bonds can be detected between atoms with explicit bonds in the PDB file. | unknown | [doc](features/settings/_batch-00.md#bond-detection-connect) |
| `connect_cutoff` | setting | affects how close atoms need to be in order for bonds to be created. | unknown | [doc](features/settings/_batch-00.md#bond-detection-connect) |
| `connect_mode` | setting | controls how bonds are detected when PDB files are loaded. 0 = auto-connect and use explicit valences 1 = use explicit valences only 2 = reserved | unknown | [doc](features/settings/_batch-00.md#bond-detection-connect) |
| `coulomb_cutoff` | setting | is the cutoff for coulombic calculations. | unknown | [doc](features/settings/_batch-00.md#electrostatics-coulomb) |
| `coulomb_dielectric` | setting | is the dielectric for coulombic calculations. | unknown | [doc](features/settings/_batch-00.md#electrostatics-coulomb) |
| `coulomb_units_factor` | setting | is the conversion factor to give output units (kT/e). | unknown | [doc](features/settings/_batch-00.md#electrostatics-coulomb) |
| `dash_as_cylinders` | setting | If true, distance measure dashes are drawn as high-quality cylinders instead of lines. | unknown | [doc](features/settings/_batch-00.md#dashed-lines-dash) |
| `dash_color` | setting | Controls the color of dashes used to represent distance measures. | unknown | [doc](features/settings/_batch-00.md#dashed-lines-dash) |
| `dash_gap` | setting | controls the length of the visible dash. | unknown | [doc](features/settings/_batch-00.md#dashed-lines-dash) |
| `dash_length` | setting | controls the separation between dashes. | unknown | [doc](features/settings/_batch-00.md#dashed-lines-dash) |
| `dash_radius` | setting | if greater than zero, controls the radius of the dash when ray tracing. Otherwise, the radius is computed from dash_width. | unknown | [doc](features/settings/_batch-00.md#dashed-lines-dash) |
| `dash_round_ends` | setting | controls whether or not dashes are rounded on their ends. | unknown | [doc](features/settings/_batch-00.md#dashed-lines-dash) |
| `dash_transparency` | setting | Transparency (0-1) of dashed lines such as distance measures. | unknown | [doc](features/settings/_batch-00.md#dashed-lines-dash) |
| `dash_use_shader` | setting | If true, on screen rendering of dashes uses the OpenGL shader language (GLSL). If false, OpenGL v1.x style rendering is used. | unknown | [doc](features/settings/_batch-00.md#dashed-lines-dash) |
| `dash_width` | setting | controls the width of the lines used to draw dashes. | unknown | [doc](features/settings/_batch-00.md#dashed-lines-dash) |
| `debug_pick` | setting | a setting for debugging mouse pick problems. | unknown | [doc](features/settings/_batch-00.md#system-gui-batch-prefix-debug-pick-colored-feedback-display-scale-factor) |
| `default_2fofc_map_rep` | setting | This controls the default map representation when a 2FoFc map is loaded from an MTZ map. | unknown | [doc](features/settings/_batch-00.md#map-mtz-auto-load-defaults-default) |
| `default_buster_names` | setting | This is the list of valid column names to be sought when autoloading Buster maps. | unknown | [doc](features/settings/_batch-00.md#map-mtz-auto-load-defaults-default) |
| `default_fofc_map_rep` | setting | This controls the default map representation when a FoFc map is loaded from an MTZ map. | unknown | [doc](features/settings/_batch-00.md#map-mtz-auto-load-defaults-default) |
| `default_phenix_names` | setting | This is the list of valid column names to be sought when autoloading Phenix maps. | unknown | [doc](features/settings/_batch-00.md#map-mtz-auto-load-defaults-default) |
| `default_phenix_no_fill_names` | setting | This is the list of valid column names to be sought when autoloading Phenix (no fill) maps. | unknown | [doc](features/settings/_batch-00.md#map-mtz-auto-load-defaults-default) |
| `default_refmac_names` | setting | This is the list of valid column names to be sought when autoloading Refmac maps. | unknown | [doc](features/settings/_batch-00.md#map-mtz-auto-load-defaults-default) |
| `defer_builds_mode` | setting | controls when the underlying geometry for molecular representations is generated, as follows: 0: visible geometry for all states of all enabled objects is generated upfront and retained in memory f... | unknown | [doc](features/settings/_batch-00.md#performance-deferred-builds-cache-async-builds-defer-cache) |
| `defer_updates` | setting | If on, scene/geometry updates are deferred (batched) rather than applied immediately. | unknown | [doc](features/settings/_batch-00.md#performance-deferred-builds-cache-async-builds-defer-cache) |
| `dihedral_color` | setting | controls dihedral measurement colors. | unknown | [doc](features/settings/_batch-00.md#measurement-labels-angle-dihedral-dist-distance-dynamic-measures) |
| `dihedral_label_position` | setting | (float: >0.0, default: 1.2) controls where the dihedral label is drawn. | unknown | [doc](features/settings/_batch-00.md#measurement-labels-angle-dihedral-dist-distance-dynamic-measures) |
| `dihedral_size` | setting | (float: >0.0, default: 0.6666) controls how far out the dihedral indicator is drawn. | unknown | [doc](features/settings/_batch-00.md#measurement-labels-angle-dihedral-dist-distance-dynamic-measures) |
| `direct` | setting | (float 0.0-1.0, default: 0.45) is the amount of light being emitted from the camera. | unknown | [doc](features/settings/_batch-00.md#lighting-ambient-direct) |
| `display_scale_factor` | setting | Integer UI/display scaling factor for high-DPI (HiDPI/Retina) screens. | unknown | [doc](features/settings/_batch-00.md#system-gui-batch-prefix-debug-pick-colored-feedback-display-scale-factor) |
| `dist_counter` | setting | is the counter used when auto-generating measurement object names. | unknown | [doc](features/settings/_batch-00.md#measurement-labels-angle-dihedral-dist-distance-dynamic-measures) |
| `distance_exclusion` | setting | controls the cutoff of bonds that two atoms must exceed if a distance is to be drawn between them when mode=3 is used as an option to the distance command. | unknown | [doc](features/settings/_batch-00.md#measurement-labels-angle-dihedral-dist-distance-dynamic-measures) |
| `dot_as_spheres` | setting | If on, dot-surface dots are drawn as small shaded spheres instead of flat points. | unknown | [doc](features/settings/_batch-00.md#dot-surface-dot) |
| `dot_color` | setting | (color, default -1) controls the color of the dot representation. By default, dots assume the color of the associated atom. | unknown | [doc](features/settings/_batch-00.md#dot-surface-dot) |
| `dot_density` | setting | controls the density of dots taken from the surface of a sphere. | implemented | [doc](features/settings/_batch-00.md#dot-surface-dot) |
| `dot_hydrogens` | setting | controls whether or not dots are drawn on hydrogen atoms. | unknown | [doc](features/settings/_batch-00.md#dot-surface-dot) |
| `dot_lighting` | setting | controls whether or not dots are lit based on their associated surface normals. The setting has no effect when ray tracing. | unknown | [doc](features/settings/_batch-00.md#dot-surface-dot) |
| `dot_mode` | setting | Dot-surface generation mode. | unknown | [doc](features/settings/_batch-00.md#dot-surface-dot) |
| `dot_normals` | setting | controls whether or not dots are drawn with normals. This achieves essentially the same effect as dot_lighting, and it too has no effect when ray tracing. | unknown | [doc](features/settings/_batch-00.md#dot-surface-dot) |
| `dot_radius` | setting | if greater than zero, controls the radius of dots. Otherwise, the dot radius is computed from dot_width based on the pixel size of the current viewport. | unknown | [doc](features/settings/_batch-00.md#dot-surface-dot) |
| `dot_solvent` | setting | controls whether we generate dots for the atomic or solvent accessible surface. | implemented | [doc](features/settings/_batch-00.md#surface-cavity-cull-dot-solvent) |
| `dot_use_shader` | setting | If true, on screen rendering of dots uses the OpenGL shader language (GLSL). If false, OpenGL v1.x style rendering is used. | unknown | [doc](features/settings/_batch-00.md#dot-surface-dot) |
| `dot_width` | setting | controls the dot width in viewport pixels. | implemented | [doc](features/settings/_batch-00.md#dot-surface-dot) |
| `draw_frames` | setting | controls whether or not each movie frame is rendered using the \draw\" command." | unknown | [doc](features/settings/_batch-00.md#rendering-antialiasing-antialias-backface-cull-draw-ati-bugs) |
| `draw_mode` | setting | 0 is the normal OpenGL renderer; 1 is antialised OpenGL; 2 is ray traced without shadows; 3 is ray traced with shadows. | unknown | [doc](features/settings/_batch-00.md#rendering-antialiasing-antialias-backface-cull-draw-ati-bugs) |
| `dynamic_measures` | setting | controls whether or not PyMOL updates measurement objects when incorporated atoms are moved. | unknown | [doc](features/settings/_batch-00.md#measurement-labels-angle-dihedral-dist-distance-dynamic-measures) |
| `dynamic_width` | setting | controls whether or not PyMOL draws lines thicker for easier viewing. | unknown | [doc](features/settings/_batch-00.md#dynamic-line-width-dynamic) |
| `dynamic_width_factor` | setting | controls the dynamic width scaling. | unknown | [doc](features/settings/_batch-00.md#dynamic-line-width-dynamic) |
| `dynamic_width_max` | setting | controls the dynamic width scaling. | unknown | [doc](features/settings/_batch-00.md#dynamic-line-width-dynamic) |
| `dynamic_width_min` | setting | controls the dynamic width scaling. | unknown | [doc](features/settings/_batch-00.md#dynamic-line-width-dynamic) |
| `edit_light` | setting | Which light source (index) is manipulated while in edit-light mode. | unknown | [doc](features/settings/_batch-01.md#editor) |
| `editor_auto_dihedral` | setting | Auto-adjust the dependent dihedral when editing torsions. | unknown | [doc](features/settings/_batch-01.md#editor) |
| `editor_auto_measure` | setting | Automatically create a measurement for the atoms being edited. | unknown | [doc](features/settings/_batch-01.md#editor) |
| `editor_auto_origin` | setting | Recenter the rotation origin on the current editor selection. | unknown | [doc](features/settings/_batch-01.md#editor) |
| `editor_bond_cycle_mode` | setting | >0 includes aromatic when cycling bond order with the builder. | unknown | [doc](features/settings/_batch-01.md#editor) |
| `editor_label_fragments` | setting | Label atoms of freshly built/attached fragments. | unknown | [doc](features/settings/_batch-01.md#editor) |
| `ellipsoid_color` | setting | Colour of ADP ellipsoids (-1 = use atom colour). | unknown | [doc](features/settings/_batch-01.md#ellipsoid) |
| `ellipsoid_probability` | setting | Probability level (0–1) defining the ellipsoid surface (0.5 ≈ 50%). | unknown | [doc](features/settings/_batch-01.md#ellipsoid) |
| `ellipsoid_quality` | setting | Tessellation subdivision level of the ellipsoid mesh. | unknown | [doc](features/settings/_batch-01.md#ellipsoid) |
| `ellipsoid_scale` | setting | Uniform scale factor applied to ellipsoid radii. | implemented | [doc](features/settings/_batch-01.md#ellipsoid) |
| `ellipsoid_transparency` | setting | Transparency (0=opaque, 1=invisible) of ellipsoids. | unknown | [doc](features/settings/_batch-01.md#ellipsoid) |
| `fast_idle` | setting | Fast idle timeout (1/100 s) before dropping to slow idle. | unknown | [doc](features/settings/_batch-01.md#performance) |
| `fetch_host` | setting | Remote host/alias used by `fetch` (e.g. 'pdb'). | unknown | [doc](features/settings/_batch-01.md#fetch) |
| `fetch_type_default` | setting | Default file type fetched when unspecified (e.g. 'cif'). | unknown | [doc](features/settings/_batch-01.md#fetch) |
| `fit_iterations` | setting | Max iterations for outlier-rejecting refinement in `fit`/`align`. | unknown | [doc](features/settings/_batch-01.md#fitting-alignment) |
| `fit_kabsch` | setting | Use the Kabsch algorithm for the least-squares fit. | unknown | [doc](features/settings/_batch-01.md#fitting-alignment) |
| `fit_tolerance` | setting | RMS convergence tolerance for the fit refinement loop. | unknown | [doc](features/settings/_batch-01.md#fitting-alignment) |
| `float_labels` | setting | Draw labels floating above geometry (depth-independent). | unknown | [doc](features/settings/_batch-01.md#label) |
| `frame` | setting | Current movie frame number. | implemented | [doc](features/settings/_batch-01.md#movie) |
| `gamma` | setting | Display gamma correction applied to the rendered image. | implemented | [doc](features/settings/_batch-01.md#camera-display) |
| `gaussian_b_adjust` | setting | B-factor offset added when building Gaussian maps. | unknown | [doc](features/settings/_batch-01.md#gaussian) |
| `gaussian_b_floor` | setting | Minimum B-factor clamp for Gaussian map generation. | unknown | [doc](features/settings/_batch-01.md#gaussian) |
| `gaussian_resolution` | setting | Effective resolution of generated Gaussian maps. | unknown | [doc](features/settings/_batch-01.md#gaussian) |
| `geometry_export_mode` | setting | Mode/format used when exporting geometry. | unknown | [doc](features/settings/_batch-01.md#file-io) |
| `gradient_max_length` | setting | Maximum length of a traced gradient line. | unknown | [doc](features/settings/_batch-01.md#gradient) |
| `gradient_min_length` | setting | Minimum length before a gradient line is kept. | unknown | [doc](features/settings/_batch-01.md#gradient) |
| `gradient_min_slope` | setting | Minimum field slope to continue tracing. | unknown | [doc](features/settings/_batch-01.md#gradient) |
| `gradient_normal_min_dot` | setting | Min normal dot-product to continue a gradient trace. | unknown | [doc](features/settings/_batch-01.md#gradient) |
| `gradient_spacing` | setting | Grid spacing (in voxels) between seeded gradient lines. | unknown | [doc](features/settings/_batch-01.md#gradient) |
| `gradient_step_size` | setting | Integration step size along a gradient line. | unknown | [doc](features/settings/_batch-01.md#gradient) |
| `gradient_symmetry` | setting | Symmetry constraint applied to gradient tracing. | unknown | [doc](features/settings/_batch-01.md#gradient) |
| `grid_max` | setting | Maximum number of grid slots (-1 = auto). | unknown | [doc](features/settings/_batch-01.md#grid) |
| `grid_mode` | setting | Grid layout mode (0 off, 1 by object, 2 by state, 3 by object+state). | unknown | [doc](features/settings/_batch-01.md#grid) |
| `grid_slot` | setting | Explicit grid slot assignment for an object (-1 = auto). | unknown | [doc](features/settings/_batch-01.md#grid) |
| `group_arrow_prefix` | setting | Prefix group children with an arrow glyph in the panel. | unknown | [doc](features/settings/_batch-01.md#group) |
| `group_auto_mode` | setting | Auto-group objects by name prefix (0/1/2). | unknown | [doc](features/settings/_batch-01.md#group) |
| `group_full_member_names` | setting | Use fully-qualified member names within groups. | unknown | [doc](features/settings/_batch-01.md#group) |
| `h_bond_cone` | setting | Angular cone (deg) tolerated around the ideal H-bond. | unknown | [doc](features/settings/_batch-01.md#h-bond) |
| `h_bond_cutoff_center` | setting | Ideal donor–acceptor distance (Å) at cone centre. | unknown | [doc](features/settings/_batch-01.md#h-bond) |
| `h_bond_cutoff_edge` | setting | Maximum donor–acceptor distance (Å) at cone edge. | unknown | [doc](features/settings/_batch-01.md#h-bond) |
| `h_bond_exclusion` | setting | Min bonds separating atoms to allow an H-bond. | unknown | [doc](features/settings/_batch-01.md#h-bond) |
| `h_bond_from_proton` | setting | Measure the H-bond angle from the proton position. | unknown | [doc](features/settings/_batch-01.md#h-bond) |
| `h_bond_max_angle` | setting | Maximum deviation angle (deg) for a valid H-bond. | unknown | [doc](features/settings/_batch-01.md#h-bond) |
| `h_bond_power_a` | setting | Exponent A in the H-bond distance/angle potential. | unknown | [doc](features/settings/_batch-01.md#h-bond) |
| `h_bond_power_b` | setting | Exponent B in the H-bond distance/angle potential. | unknown | [doc](features/settings/_batch-01.md#h-bond) |
| `half_bonds` | setting | Split bonds at midpoint into two atom-coloured halves. | unknown | [doc](features/settings/_batch-01.md#bonds-display) |
| `halogen_bond_as_acceptor_max_acceptor_angle` | setting | Max acceptor angle when halogen is acceptor. | unknown | [doc](features/settings/_batch-01.md#halogen-bond) |
| `halogen_bond_as_acceptor_min_acceptor_angle` | setting | Min acceptor angle when halogen is acceptor. | unknown | [doc](features/settings/_batch-01.md#halogen-bond) |
| `halogen_bond_as_acceptor_min_donor_angle` | setting | Min donor angle when halogen is acceptor. | unknown | [doc](features/settings/_batch-01.md#halogen-bond) |
| `halogen_bond_as_donor_min_acceptor_angle` | setting | Min acceptor angle when halogen is donor. | unknown | [doc](features/settings/_batch-01.md#halogen-bond) |
| `halogen_bond_as_donor_min_donor_angle` | setting | Min donor angle when halogen is donor. | unknown | [doc](features/settings/_batch-01.md#halogen-bond) |
| `halogen_bond_distance` | setting | Max halogen-bond distance (Å). | unknown | [doc](features/settings/_batch-01.md#halogen-bond) |
| `hash_max` | setting | Spatial-hash grid capacity for neighbour searches. | unknown | [doc](features/settings/_batch-01.md#performance) |
| `heavy_neighbor_cutoff` | setting | Distance cutoff for heavy-atom neighbour inference. | unknown | [doc](features/settings/_batch-01.md#proximity) |
| `hide_long_bonds` | setting | Do not draw bonds longer than the expected length. | unknown | [doc](features/settings/_batch-01.md#bonds-display) |
| `hide_underscore_names` | setting | Hide objects/selections whose names start with '_'. | unknown | [doc](features/settings/_batch-01.md#selecting) |
| `idle_delay` | setting | Seconds of inactivity before entering idle animation. | unknown | [doc](features/settings/_batch-01.md#performance) |
| `ignore_case` | setting | Case-insensitive matching of names/identifiers in selections. | unknown | [doc](features/settings/_batch-01.md#selecting) |
| `ignore_case_chain` | setting | Case-insensitive matching specifically for chain IDs. | unknown | [doc](features/settings/_batch-01.md#selecting) |
| `ignore_pdb_segi` | setting | Ignore the PDB segment identifier on import. | unknown | [doc](features/settings/_batch-01.md#selecting) |
| `image_copy_always` | setting | Always copy rendered images to the clipboard. | unknown | [doc](features/settings/_batch-01.md#file-io) |
| `internal_feedback` | setting | Number of feedback text lines shown in the viewport. | unknown | [doc](features/settings/_batch-01.md#internal-gui) |
| `internal_gui` | setting | Show the internal (in-viewport) object menu panel. | unknown | [doc](features/settings/_batch-01.md#internal-gui) |
| `internal_gui_control_size` | setting | Size (px) of internal GUI control rows. | unknown | [doc](features/settings/_batch-01.md#internal-gui) |
| `internal_gui_mode` | setting | Internal GUI rendering mode. | unknown | [doc](features/settings/_batch-01.md#internal-gui) |
| `internal_gui_name_color_mode` | setting | How object names are colourised in the panel (0–2). | unknown | [doc](features/settings/_batch-01.md#internal-gui) |
| `internal_gui_width` | setting | Width (px) of the internal GUI panel. | unknown | [doc](features/settings/_batch-01.md#internal-gui) |
| `internal_prompt` | setting | Show the internal command prompt line. | unknown | [doc](features/settings/_batch-01.md#internal-gui) |
| `isomesh_auto_state` | setting | Auto-track the current state for `isomesh` maps. | unknown | [doc](features/settings/_batch-01.md#mesh) |
| `isosurface_algorithm` | setting | Marching-cubes variant used for isosurfaces (0–2). | unknown | [doc](features/settings/_batch-01.md#map-io) |
| `keep_alive` | setting | Keep the render loop running even when idle. | unknown | [doc](features/settings/_batch-01.md#performance) |
| `label_anchor` | setting | Atom name used to anchor a residue's label (e.g. 'CA'). | unknown | [doc](features/settings/_batch-01.md#label) |
| `label_angle_digits` | setting | Decimal digits for angle labels (-1 = use label_digits). | unknown | [doc](features/settings/_batch-01.md#label) |
| `label_bg_color` | setting | Label background box colour (-1 = none). | unknown | [doc](features/settings/_batch-01.md#label) |
| `label_bg_outline` | setting | Draw an outline around the label background box. | unknown | [doc](features/settings/_batch-01.md#label) |
| `label_bg_transparency` | setting | Transparency of the label background box. | unknown | [doc](features/settings/_batch-01.md#label) |
| `label_color` | setting | Label text colour (-6 = 'front' default). | unknown | [doc](features/settings/_batch-01.md#label) |
| `label_connector` | setting | Draw a connector line from label to its anchor atom. | unknown | [doc](features/settings/_batch-01.md#label) |
| `label_connector_color` | setting | Colour of the label connector line (-6 = front). | unknown | [doc](features/settings/_batch-01.md#label) |
| `label_connector_ext_length` | setting | Extension length of the connector beyond the label. | unknown | [doc](features/settings/_batch-01.md#label) |
| `label_connector_mode` | setting | Connector routing style (0–4). | unknown | [doc](features/settings/_batch-01.md#label) |
| `label_connector_width` | setting | Line width of the label connector. | unknown | [doc](features/settings/_batch-01.md#label) |
| `label_digits` | setting | Default decimal digits shown in numeric labels. | unknown | [doc](features/settings/_batch-01.md#label) |
| `label_dihedral_digits` | setting | Decimal digits for dihedral labels (-1 = use label_digits). | unknown | [doc](features/settings/_batch-01.md#label) |
| `label_distance_digits` | setting | Decimal digits for distance labels (-1 = use label_digits). | unknown | [doc](features/settings/_batch-01.md#label) |
| `label_font_id` | setting | Font index used to render labels. | unknown | [doc](features/settings/_batch-01.md#label) |
| `label_multiline_justification` | setting | Horizontal justification of multiline labels. | unknown | [doc](features/settings/_batch-01.md#label) |
| `label_multiline_spacing` | setting | Line-spacing factor for multiline labels. | unknown | [doc](features/settings/_batch-01.md#label) |
| `label_outline_color` | setting | Outline colour for label glyphs (-1 = none). | unknown | [doc](features/settings/_batch-01.md#label) |
| `label_padding` | setting | Padding [x,y,z] around label text within its box. | unknown | [doc](features/settings/_batch-01.md#label) |
| `label_placement_offset` | setting | Additional [x,y,z] offset applied to label placement. | unknown | [doc](features/settings/_batch-01.md#label) |
| `label_position` | setting | Label position offset [x,y,z] relative to the anchor atom. | unknown | [doc](features/settings/_batch-01.md#label) |
| `label_relative_mode` | setting | Interpret label_position relative to screen/atom (0–2). | unknown | [doc](features/settings/_batch-01.md#label) |
| `label_screen_point` | setting | Fixed screen anchor point [x,y,z] for the label. | unknown | [doc](features/settings/_batch-01.md#label) |
| `label_shadow_mode` | setting | Whether labels cast/receive shadows in ray tracing. | unknown | [doc](features/settings/_batch-01.md#label) |
| `label_size` | setting | Label text size (points; negative = world units). | unknown | [doc](features/settings/_batch-01.md#label) |
| `label_z_target` | setting | Z-target mode used when depth-placing labels. | unknown | [doc](features/settings/_batch-01.md#label) |
| `legacy_mouse_zoom` | setting | Use pre-1.x mouse-zoom direction/behaviour. | unknown | [doc](features/settings/_batch-01.md#mouse) |
| `light` | setting | Direction vector of the primary directional light. | implemented | [doc](features/settings/_batch-01.md#lighting) |
| `light2` | setting | Direction vector of light source 2. | implemented | [doc](features/settings/_batch-01.md#lighting) |
| `light3` | setting | Direction vector of light source 3. | unknown | [doc](features/settings/_batch-01.md#lighting) |
| `light4` | setting | Direction vector of light source 4. | unknown | [doc](features/settings/_batch-01.md#lighting) |
| `light5` | setting | Direction vector of light source 5. | unknown | [doc](features/settings/_batch-01.md#lighting) |
| `light6` | setting | Direction vector of light source 6. | unknown | [doc](features/settings/_batch-01.md#lighting) |
| `light7` | setting | Direction vector of light source 7. | unknown | [doc](features/settings/_batch-01.md#lighting) |
| `light8` | setting | Direction vector of light source 8. | unknown | [doc](features/settings/_batch-01.md#lighting) |
| `light9` | setting | Direction vector of light source 9. | unknown | [doc](features/settings/_batch-01.md#lighting) |
| `line_as_cylinders` | setting | Render wireframe lines as shader cylinders. | unknown | [doc](features/settings/_batch-01.md#line) |
| `line_color` | setting | Line/wireframe colour (-1 = use atom colour). | unknown | [doc](features/settings/_batch-01.md#line) |
| `line_radius` | setting | Cylinder radius when lines are drawn as cylinders (0 = flat). | unknown | [doc](features/settings/_batch-01.md#line) |
| `line_smooth` | setting | Enable GL line antialiasing/smoothing. | unknown | [doc](features/settings/_batch-01.md#line) |
| `line_stick_helper` | setting | Assist line drawing where lines meet sticks. | unknown | [doc](features/settings/_batch-01.md#line) |
| `line_use_shader` | setting | Use the GLSL shader path for lines. | unknown | [doc](features/settings/_batch-01.md#line) |
| `line_width` | setting | Wireframe line width in pixels (<1.5 keeps SGI AA). | implemented | [doc](features/settings/_batch-01.md#line) |
| `load_atom_props_default` | setting | Atom properties auto-loaded by default ('*' = all). | unknown | [doc](features/settings/_batch-01.md#file-io) |
| `load_object_props_default` | setting | Object properties auto-loaded by default ('*' = all). | unknown | [doc](features/settings/_batch-01.md#file-io) |
| `log_box_selections` | setting | Log box (drag) selections to the log file. | unknown | [doc](features/settings/_batch-01.md#logging) |
| `log_conformations` | setting | Log conformational edits to the log file. | unknown | [doc](features/settings/_batch-01.md#logging) |
| `logging` | setting | Logging mode/verbosity (0 off, 1 .pml, 2 .py). | implemented | [doc](features/settings/_batch-01.md#logging) |
| `map_auto_expand_sym` | setting | Auto-expand map by crystal symmetry on load. | unknown | [doc](features/settings/_batch-01.md#map-io) |
| `matrix_mode` | setting | How object matrices combine (-1 legacy / 0 history / 1 coord-mod ...). | unknown | [doc](features/settings/_batch-01.md#fitting-alignment) |
| `max_threads` | setting | Maximum worker threads for parallel tasks. | unknown | [doc](features/settings/_batch-01.md#performance) |
| `max_ups` | setting | Cap on updates-per-second of the main loop (0 = uncapped). | unknown | [doc](features/settings/_batch-01.md#performance) |
| `mesh_as_cylinders` | setting | Render mesh edges as shader cylinders. | unknown | [doc](features/settings/_batch-01.md#mesh) |
| `mesh_carve_cutoff` | setting | Distance cutoff for carving mesh around a selection. | unknown | [doc](features/settings/_batch-01.md#mesh) |
| `mesh_carve_selection` | setting | Selection used to carve (keep-near) the mesh. | unknown | [doc](features/settings/_batch-01.md#mesh) |
| `mesh_carve_state` | setting | State used for the mesh carve selection. | unknown | [doc](features/settings/_batch-01.md#mesh) |
| `mesh_clear_cutoff` | setting | Distance cutoff for clearing mesh near a selection. | unknown | [doc](features/settings/_batch-01.md#mesh) |
| `mesh_clear_selection` | setting | Selection used to clear (remove-near) the mesh. | unknown | [doc](features/settings/_batch-01.md#mesh) |
| `mesh_clear_state` | setting | State used for the mesh clear selection. | unknown | [doc](features/settings/_batch-01.md#mesh) |
| `mesh_color` | setting | Mesh colour (-1 = use object/atom colour). | unknown | [doc](features/settings/_batch-01.md#mesh) |
| `mesh_cutoff` | setting | Density/contour cutoff for the mesh isosurface. | unknown | [doc](features/settings/_batch-01.md#mesh) |
| `mesh_grid_max` | setting | Maximum grid dimension when generating the mesh. | unknown | [doc](features/settings/_batch-01.md#mesh) |
| `mesh_lighting` | setting | Apply lighting/shading to mesh lines. | unknown | [doc](features/settings/_batch-01.md#mesh) |
| `mesh_mode` | setting | Mesh generation mode (0 = by flag default). | unknown | [doc](features/settings/_batch-01.md#mesh) |
| `mesh_negative_color` | setting | Colour for the negative contour of a signed map. | unknown | [doc](features/settings/_batch-01.md#mesh) |
| `mesh_negative_visible` | setting | Show the negative contour of a signed map. | unknown | [doc](features/settings/_batch-01.md#mesh) |
| `mesh_normals` | setting | Compute vertex normals for the mesh. | unknown | [doc](features/settings/_batch-01.md#mesh) |
| `mesh_quality` | setting | Mesh tessellation quality level. | unknown | [doc](features/settings/_batch-01.md#mesh) |
| `mesh_radius` | setting | Mesh line radius (0 = use mesh_width pixels). | unknown | [doc](features/settings/_batch-01.md#mesh) |
| `mesh_skip` | setting | Skip factor to decimate mesh lines. | unknown | [doc](features/settings/_batch-01.md#mesh) |
| `mesh_solvent` | setting | Generate a solvent-excluded mesh surface. | unknown | [doc](features/settings/_batch-01.md#mesh) |
| `mesh_type` | setting | Mesh type (0 isomesh lines / 1 dots). | unknown | [doc](features/settings/_batch-01.md#mesh) |
| `mesh_use_shader` | setting | Use the GLSL shader path for meshes. | unknown | [doc](features/settings/_batch-01.md#mesh) |
| `mesh_width` | setting | Mesh line width in pixels. | unknown | [doc](features/settings/_batch-01.md#mesh) |
| `min_mesh_spacing` | setting | Minimum grid spacing allowed when meshing. | unknown | [doc](features/settings/_batch-01.md#mesh) |
| `moe_separate_chains` | setting | Split MOE-imported structures into separate chains (-1 auto). | unknown | [doc](features/settings/_batch-01.md#file-io) |
| `motion_bias` | setting | Bias of keyframe interpolation easing (-1 = default). | unknown | [doc](features/settings/_batch-01.md#motion) |
| `motion_hand` | setting | Handedness/direction of rocking motion. | unknown | [doc](features/settings/_batch-01.md#motion) |
| `motion_linear` | setting | Blend toward linear interpolation (0–1). | unknown | [doc](features/settings/_batch-01.md#motion) |
| `motion_power` | setting | Easing power applied to motion interpolation. | unknown | [doc](features/settings/_batch-01.md#motion) |
| `motion_simple` | setting | Use simplified (linear) motion interpolation. | unknown | [doc](features/settings/_batch-01.md#motion) |
| `mouse_grid` | setting | Show the mouse-mode grid/config overlay. | implemented | [doc](features/settings/_batch-01.md#mouse) |
| `mouse_limit` | setting | Clamp on virtual-trackball rotation magnitude. | unknown | [doc](features/settings/_batch-01.md#mouse) |
| `mouse_restart_movie_delay` | setting | Delay before a click restarts a stopped movie. | unknown | [doc](features/settings/_batch-01.md#mouse) |
| `mouse_scale` | setting | Sensitivity scale for mouse rotation/translation. | unknown | [doc](features/settings/_batch-01.md#mouse) |
| `mouse_selection_mode` | setting | Picking granularity (atom/residue/chain/... level). | implemented | [doc](features/settings/_batch-01.md#mouse) |
| `mouse_wheel_scale` | setting | Zoom step per mouse-wheel notch. | unknown | [doc](features/settings/_batch-01.md#mouse) |
| `mouse_z_scale` | setting | Sensitivity of z-axis (clip/translate) mouse motion. | unknown | [doc](features/settings/_batch-01.md#mouse) |
| `movie_animate_by_frame` | setting | Animate by frame rather than by state. | unknown | [doc](features/settings/_batch-01.md#movie) |
| `movie_auto_interpolate` | setting | Auto-interpolate camera between movie keyframes. | implemented | [doc](features/settings/_batch-01.md#movie) |
| `movie_auto_store` | setting | Auto-store frames into the movie cache (-1 = auto). | unknown | [doc](features/settings/_batch-01.md#movie) |
| `movie_delay` | setting | Delay between movie frames (ms) when not fps-driven. | unknown | [doc](features/settings/_batch-01.md#movie) |
| `movie_fps` | setting | Target movie playback frame rate. | implemented | [doc](features/settings/_batch-01.md#movie) |
| `movie_loop` | setting | Loop the movie on reaching the end. | unknown | [doc](features/settings/_batch-01.md#movie) |
| `movie_panel` | setting | Show the movie timeline panel. | unknown | [doc](features/settings/_batch-01.md#movie) |
| `movie_panel_row_height` | setting | Row height (px) of the movie panel. | unknown | [doc](features/settings/_batch-01.md#movie) |
| `movie_quality` | setting | Encoding quality for exported movies (0–100). | implemented | [doc](features/settings/_batch-01.md#movie) |
| `movie_rock` | setting | Rocking motion mode for the movie (-1 = off). | unknown | [doc](features/settings/_batch-01.md#movie) |
| `multiplex` | setting | Load multi-model files as separate objects (-1 auto). | unknown | [doc](features/settings/_batch-01.md#file-io) |
| `nb_spheres_quality` | setting | Tessellation quality of nonbonded spheres (0–max). | unknown | [doc](features/settings/_batch-01.md#nb-spheres) |
| `nb_spheres_size` | setting | Radius of nonbonded spheres. | implemented | [doc](features/settings/_batch-01.md#nb-spheres) |
| `nb_spheres_use_shader` | setting | Use the shader path for nonbonded spheres (0–2). | unknown | [doc](features/settings/_batch-01.md#nb-spheres) |
| `neighbor_cutoff` | setting | General distance cutoff for neighbour/bond inference. | unknown | [doc](features/settings/_batch-01.md#proximity) |
| `no_idle` | setting | Delay (1/500 s) before any idle processing starts. | unknown | [doc](features/settings/_batch-01.md#performance) |
| `nonbonded_as_cylinders` | setting | Render nonbonded crosses as shader cylinders. | unknown | [doc](features/settings/_batch-01.md#nonbonded) |
| `nonbonded_size` | setting | Size of the nonbonded cross representation. | implemented | [doc](features/settings/_batch-01.md#nonbonded) |
| `nonbonded_transparency` | setting | Transparency of nonbonded crosses. | unknown | [doc](features/settings/_batch-01.md#nonbonded) |
| `nonbonded_use_shader` | setting | Use the shader path for the nonbonded representation. | unknown | [doc](features/settings/_batch-01.md#nonbonded) |
| `normal_workaround` | setting | Enable a surface-normal driver workaround. | unknown | [doc](features/settings/_batch-01.md#performance) |
| `normalize_ccp4_maps` | setting | Normalise CCP4/MRC maps to sigma units on load. | unknown | [doc](features/settings/_batch-01.md#map-io) |
| `normalize_grd_maps` | setting | Normalise GRD maps on load. | unknown | [doc](features/settings/_batch-01.md#map-io) |
| `normalize_o_maps` | setting | Normalise O/DSN6 maps on load. | unknown | [doc](features/settings/_batch-01.md#map-io) |
| `nvidia_bugs` | setting | Enable NVIDIA driver bug workarounds. | unknown | [doc](features/settings/_batch-01.md#performance) |
| `openvr_cut_laser` | setting | Enable the cut laser for the VR molecule picker. | internal | [doc](features/settings/_batch-01.md#openvr) |
| `openvr_disable_clipping` | setting | Disable near/far clipping in VR. | internal | [doc](features/settings/_batch-01.md#openvr) |
| `openvr_far_plane` | setting | Far clipping plane distance in VR. | internal | [doc](features/settings/_batch-01.md#openvr) |
| `openvr_gui_alpha` | setting | Opacity of the VR GUI overlay (0–1). | internal | [doc](features/settings/_batch-01.md#openvr) |
| `openvr_gui_back_alpha` | setting | Opacity of the VR GUI backing panel. | internal | [doc](features/settings/_batch-01.md#openvr) |
| `openvr_gui_back_color` | setting | Grey level of the VR GUI backing panel. | internal | [doc](features/settings/_batch-01.md#openvr) |
| `openvr_gui_distance` | setting | Distance the VR GUI floats from the viewer. | internal | [doc](features/settings/_batch-01.md#openvr) |
| `openvr_gui_fov` | setting | Field of view of the VR GUI overlay (0–89 deg). | internal | [doc](features/settings/_batch-01.md#openvr) |
| `openvr_gui_overlay` | setting | VR GUI overlay mode (0 off, 1 on, 2 laser-triggered). | internal | [doc](features/settings/_batch-01.md#openvr) |
| `openvr_gui_scene_alpha` | setting | Opacity of the in-headset scene/GUI panel. | unknown | [doc](features/settings/_batch-02.md#openvr) |
| `openvr_gui_scene_color` | setting | Colour of the in-headset scene GUI backdrop. | unknown | [doc](features/settings/_batch-02.md#openvr) |
| `openvr_gui_text` | setting | Text-rendering mode for the VR GUI. | unknown | [doc](features/settings/_batch-02.md#openvr) |
| `openvr_gui_use_alpha` | setting | Whether the VR GUI panel is alpha-blended (0/1/2). | unknown | [doc](features/settings/_batch-02.md#openvr) |
| `openvr_gui_use_backdrop` | setting | Whether the VR GUI draws a backdrop (0/1/2). | unknown | [doc](features/settings/_batch-02.md#openvr) |
| `openvr_laser_width` | setting | Pixel width of the VR pointer laser. | unknown | [doc](features/settings/_batch-02.md#openvr) |
| `openvr_near_plane` | setting | Near clipping-plane distance for the VR view. | unknown | [doc](features/settings/_batch-02.md#openvr) |
| `overlay` | setting | Number of lines of console text overlaid on the viewport (0/1/3/5). | unknown | [doc](features/settings/_batch-02.md#display) |
| `overlay_lines` | setting | Maximum number of overlay text lines retained. | unknown | [doc](features/settings/_batch-02.md#display) |
| `pdb_conect_all` | setting | Write CONECT records for all bonds, not just non-standard ones. | unknown | [doc](features/settings/_batch-02.md#pdb) |
| `pdb_conect_nodup` | setting | Suppress duplicate CONECT entries on export. | unknown | [doc](features/settings/_batch-02.md#pdb) |
| `pdb_discrete_chains` | setting | Assign discrete chain IDs on load (-1 = auto). | unknown | [doc](features/settings/_batch-02.md#pdb) |
| `pdb_echo_tags` | setting | Which PDB header record tags are echoed to the log (default HEADER, TITLE, COMPND). | unknown | [doc](features/settings/_batch-02.md#pdb) |
| `pdb_formal_charges` | setting | Read/write formal charges from PDB columns. | unknown | [doc](features/settings/_batch-02.md#pdb) |
| `pdb_hetatm_guess_valences` | setting | Guess bond valences for HETATM residues on load. | unknown | [doc](features/settings/_batch-02.md#pdb) |
| `pdb_hetatm_sort` | setting | Sorting mode applied to HETATM records. | unknown | [doc](features/settings/_batch-02.md#pdb) |
| `pdb_honor_model_number` | setting | Honour MODEL numbers as explicit state indices. | unknown | [doc](features/settings/_batch-02.md#pdb) |
| `pdb_ignore_conect` | setting | Ignore CONECT records when reading connectivity. | unknown | [doc](features/settings/_batch-02.md#pdb) |
| `pdb_insertions_go_first` | setting | Place insertion-code residues before the base residue. | unknown | [doc](features/settings/_batch-02.md#pdb) |
| `pdb_insure_orthogonal` | setting | Force the crystal cell to be orthogonalised. | unknown | [doc](features/settings/_batch-02.md#pdb) |
| `pdb_literal_names` | setting | Keep atom names verbatim instead of PDB-standard reformatting. | implemented | [doc](features/settings/_batch-02.md#pdb) |
| `pdb_no_end_record` | setting | Omit the END record when writing PDB files. | unknown | [doc](features/settings/_batch-02.md#pdb) |
| `pdb_reformat_names_mode` | setting | Atom-name reformatting mode on load (0..4). | implemented | [doc](features/settings/_batch-02.md#pdb) |
| `pdb_retain_ids` | setting | Retain original PDB serial IDs. | unknown | [doc](features/settings/_batch-02.md#pdb) |
| `pdb_standard_order` | setting | Reorder atoms into standard residue order. | unknown | [doc](features/settings/_batch-02.md#pdb) |
| `pdb_truncate_residue_name` | setting | Truncate residue names to 3 characters. | unknown | [doc](features/settings/_batch-02.md#pdb) |
| `pdb_unbond_cations` | setting | Remove spurious bonds to metal cations on load. | unknown | [doc](features/settings/_batch-02.md#pdb) |
| `pdb_use_ter_records` | setting | Emit/honour TER records to break polymer chains. | unknown | [doc](features/settings/_batch-02.md#pdb) |
| `pick_labels` | setting | Allow labels to be picked/selected. | unknown | [doc](features/settings/_batch-02.md#picking) |
| `pick_shading` | setting | Apply shading during the picking pass. | unknown | [doc](features/settings/_batch-02.md#picking) |
| `pick_surface` | setting | Make surfaces pickable. | unknown | [doc](features/settings/_batch-02.md#picking) |
| `pick32bit` | setting | Use 32-bit colour-index picking buffers for large scenes. | unknown | [doc](features/settings/_batch-02.md#picking) |
| `pickable` | setting | Global toggle for whether objects can be picked. | unknown | [doc](features/settings/_batch-02.md#picking) |
| `png_file_gamma` | setting | Gamma applied when writing PNG files. | unknown | [doc](features/settings/_batch-02.md#image) |
| `png_screen_gamma` | setting | Gamma assumed for on-screen display when producing PNGs. | unknown | [doc](features/settings/_batch-02.md#image) |
| `polar_neighbor_cutoff` | setting | Distance cutoff for polar-neighbour detection. | unknown | [doc](features/settings/_batch-02.md#measurement) |
| `power` | setting | Overall lighting power/exponent for ray shading. | unknown | [doc](features/settings/_batch-02.md#lighting) |
| `pqr_no_chain_id` | setting | Omit chain IDs when writing PQR files. | unknown | [doc](features/settings/_batch-02.md#pdb) |
| `precomputed_lighting` | setting | Use a precomputed lighting texture for shader rendering. | unknown | [doc](features/settings/_batch-02.md#display) |
| `presentation` | setting | Enter presentation mode (hides GUI chrome). | unknown | [doc](features/settings/_batch-02.md#presentation) |
| `presentation_auto_quit` | setting | Auto-quit at the end of a presentation. | unknown | [doc](features/settings/_batch-02.md#presentation) |
| `presentation_auto_start` | setting | Auto-start the presentation on load. | unknown | [doc](features/settings/_batch-02.md#presentation) |
| `presentation_mode` | setting | Presentation playback mode. | unknown | [doc](features/settings/_batch-02.md#presentation) |
| `preserve_chempy_ids` | setting | Keep ChemPy model atom IDs on load instead of renumbering. | unknown | [doc](features/settings/_batch-02.md#rock) |
| `pse_binary_dump` | setting | Write PSE sessions using the fast binary dump format. | unknown | [doc](features/settings/_batch-02.md#presentation) |
| `pse_export_version` | setting | Target PSE file-format version on export (0 = current). | unknown | [doc](features/settings/_batch-02.md#presentation) |
| `pymol_space_max_blue` | setting | Max blue component in the "pymol" named colour space. | unknown | [doc](features/settings/_batch-02.md#coloring) |
| `pymol_space_max_green` | setting | Max green component in the "pymol" colour space. | unknown | [doc](features/settings/_batch-02.md#coloring) |
| `pymol_space_max_red` | setting | Max red component in the "pymol" colour space. | unknown | [doc](features/settings/_batch-02.md#coloring) |
| `pymol_space_min_factor` | setting | Minimum floor factor for the "pymol" colour space. | unknown | [doc](features/settings/_batch-02.md#coloring) |
| `ramp_blend_nearby_colors` | setting | Blend adjacent ramp colours for smoother gradients. | unknown | [doc](features/settings/_batch-02.md#coloring) |
| `rank_assisted_sorts` | setting | Use rank-assisted algorithm when sorting atoms. | unknown | [doc](features/settings/_batch-02.md#rock) |
| `ray_blend_blue` | setting | Blue weight when ray_blend_colors mixes toward background. | unknown | [doc](features/settings/_batch-02.md#ray) |
| `ray_blend_colors` | setting | Blend ray colours toward the fog/background tint. | unknown | [doc](features/settings/_batch-02.md#ray) |
| `ray_blend_green` | setting | Green weight for ray colour blending. | unknown | [doc](features/settings/_batch-02.md#ray) |
| `ray_blend_red` | setting | Red weight for ray colour blending. | unknown | [doc](features/settings/_batch-02.md#ray) |
| `ray_clip_shadows` | setting | Clip shadows against the near/far planes. | unknown | [doc](features/settings/_batch-02.md#ray) |
| `ray_color_ramps` | setting | Let ray tracing honour colour ramps. | unknown | [doc](features/settings/_batch-02.md#ray) |
| `ray_direct_shade` | setting | Amount of direct (non-shadowed) shading added. | unknown | [doc](features/settings/_batch-02.md#ray) |
| `ray_hint_camera` | setting | Camera-distance hint constant for the ray tracer. | unknown | [doc](features/settings/_batch-02.md#ray) |
| `ray_hint_shadow` | setting | Shadow-distance hint constant for the ray tracer. | unknown | [doc](features/settings/_batch-02.md#ray) |
| `ray_improve_shadows` | setting | Refine/soften shadow edges during ray tracing. | unknown | [doc](features/settings/_batch-02.md#ray) |
| `ray_interior_reflect` | setting | Reflectivity of interior surfaces. | unknown | [doc](features/settings/_batch-02.md#ray) |
| `ray_interior_shadows` | setting | Cast shadows onto interior surfaces. | unknown | [doc](features/settings/_batch-02.md#ray) |
| `ray_interior_texture` | setting | Texture index applied to interior surfaces (-1 = none). | unknown | [doc](features/settings/_batch-02.md#ray) |
| `ray_label_connector_flat` | setting | Draw label connector lines flat when ray tracing. | unknown | [doc](features/settings/_batch-02.md#ray) |
| `ray_label_specular` | setting | Specular strength on ray-traced label connectors. | unknown | [doc](features/settings/_batch-02.md#ray) |
| `ray_legacy_lighting` | setting | Blend toward pre-1.8 legacy lighting model (0..1). | unknown | [doc](features/settings/_batch-02.md#ray) |
| `ray_max_passes` | setting | Maximum antialiasing/refinement passes. | unknown | [doc](features/settings/_batch-02.md#ray) |
| `ray_orthoscopic` | setting | Ray-trace with orthographic projection (-1 = follow orthoscopic). | unknown | [doc](features/settings/_batch-02.md#ray) |
| `ray_oversample_cutoff` | setting | Pixel-neighbourhood cutoff for oversampling. | unknown | [doc](features/settings/_batch-02.md#ray) |
| `ray_pixel_scale` | setting | Scale factor applied to raster oversampling detail. | unknown | [doc](features/settings/_batch-02.md#ray) |
| `ray_scatter` | setting | Adds diffuse light scatter/ambient occlusion term. | unknown | [doc](features/settings/_batch-02.md#ray) |
| `ray_shadow_decay_factor` | setting | Distance decay factor for shadow darkness (0 = no decay). | unknown | [doc](features/settings/_batch-02.md#ray) |
| `ray_shadow_decay_range` | setting | Range over which shadow decay is applied. | unknown | [doc](features/settings/_batch-02.md#ray) |
| `ray_shadow_fudge` | setting | Small offset to avoid shadow self-intersection artefacts. | unknown | [doc](features/settings/_batch-02.md#ray) |
| `ray_spec_local` | setting | Use local (per-light position) specular highlights. | unknown | [doc](features/settings/_batch-02.md#ray) |
| `ray_texture` | setting | Surface texture pattern index (0 = none). | unknown | [doc](features/settings/_batch-02.md#ray) |
| `ray_texture_settings` | setting | Three texture tuning parameters for ray_texture. | unknown | [doc](features/settings/_batch-02.md#ray) |
| `ray_trace_color` | setting | Outline colour used by ray_trace_mode (-6 = default). | unknown | [doc](features/settings/_batch-02.md#ray) |
| `ray_trace_depth_factor` | setting | Depth-cue weighting for outline (trace) rendering. | unknown | [doc](features/settings/_batch-02.md#ray) |
| `ray_trace_disco_factor` | setting | Discontinuity sensitivity for outline detection. | unknown | [doc](features/settings/_batch-02.md#ray) |
| `ray_trace_fog` | setting | Fog amount in ray output (-1 = follow depth_cue/fog). | unknown | [doc](features/settings/_batch-02.md#ray) |
| `ray_trace_fog_start` | setting | Where fog begins in ray output (-1 = follow fog_start). | unknown | [doc](features/settings/_batch-02.md#ray) |
| `ray_trace_persist_cutoff` | setting | Persistence cutoff for outline edges. | unknown | [doc](features/settings/_batch-02.md#ray) |
| `ray_trace_slope_factor` | setting | Slope weighting for outline edge detection. | unknown | [doc](features/settings/_batch-02.md#ray) |
| `ray_trace_trans_cutoff` | setting | Transparency cutoff below which outlines are drawn. | unknown | [doc](features/settings/_batch-02.md#ray) |
| `ray_transparency_contrast` | setting | Contrast of transparent-surface shading. | unknown | [doc](features/settings/_batch-02.md#ray) |
| `ray_transparency_oblique` | setting | Extra opacity at oblique (grazing) transparency angles. | unknown | [doc](features/settings/_batch-02.md#ray) |
| `ray_transparency_oblique_power` | setting | Exponent controlling the oblique transparency falloff. | unknown | [doc](features/settings/_batch-02.md#ray) |
| `ray_transparency_shadows` | setting | Let transparent surfaces cast shadows. | unknown | [doc](features/settings/_batch-02.md#ray) |
| `ray_transparency_spec_cut` | setting | Specular cutoff on transparent surfaces. | unknown | [doc](features/settings/_batch-02.md#ray) |
| `ray_transparency_specular` | setting | Specular intensity on transparent surfaces. | unknown | [doc](features/settings/_batch-02.md#ray) |
| `ray_triangle_fudge` | setting | Tiny geometric epsilon for triangle intersection. | unknown | [doc](features/settings/_batch-02.md#ray) |
| `ray_volume` | setting | Enable volumetric ray rendering path. | unknown | [doc](features/settings/_batch-02.md#ray) |
| `reflect_power` | setting | Exponent (falloff sharpness) of diffuse reflection. | unknown | [doc](features/settings/_batch-02.md#lighting) |
| `render_as_cylinders` | setting | Render bonds/edges as shader cylinders where supported. | unknown | [doc](features/settings/_batch-02.md#rock) |
| `retain_order` | setting | Preserve original atom ordering on load rather than re-sorting. | unknown | [doc](features/settings/_batch-02.md#fileio) |
| `ribbon_as_cylinders` | setting | Draw ribbon traces as cylinders instead of lines. | unknown | [doc](features/settings/_batch-02.md#ribbon) |
| `ribbon_color` | setting | Ribbon colour (-1 = inherit from atom). | unknown | [doc](features/settings/_batch-02.md#ribbon) |
| `ribbon_nucleic_acid_mode` | setting | Nucleic-acid ribbon path mode. | unknown | [doc](features/settings/_batch-02.md#ribbon) |
| `ribbon_power` | setting | Spline tension/power along the ribbon. | unknown | [doc](features/settings/_batch-02.md#ribbon) |
| `ribbon_power_b` | setting | Secondary spline tension parameter. | unknown | [doc](features/settings/_batch-02.md#ribbon) |
| `ribbon_radius` | setting | Ribbon tube radius (0 = auto from width). | unknown | [doc](features/settings/_batch-02.md#ribbon) |
| `ribbon_sampling` | setting | Spline samples per residue segment. | implemented | [doc](features/settings/_batch-02.md#ribbon) |
| `ribbon_side_chain_helper` | setting | Hide backbone lines where ribbon is shown to reduce clutter. | unknown | [doc](features/settings/_batch-02.md#ribbon) |
| `ribbon_throw` | setting | Spline overshoot/throw distance. | unknown | [doc](features/settings/_batch-02.md#ribbon) |
| `ribbon_trace_atoms` | setting | Trace through every atom rather than CA/backbone only. | unknown | [doc](features/settings/_batch-02.md#ribbon) |
| `ribbon_transparency` | setting | Ribbon transparency (0 opaque .. 1 invisible). | unknown | [doc](features/settings/_batch-02.md#ribbon) |
| `ribbon_use_shader` | setting | Render ribbons through the GPU shader path. | unknown | [doc](features/settings/_batch-02.md#ribbon) |
| `ribbon_width` | setting | Ribbon line width in pixels. | implemented | [doc](features/settings/_batch-02.md#ribbon) |
| `robust_logs` | setting | Emit more verbose/robust command logging. | unknown | [doc](features/settings/_batch-02.md#rock) |
| `rock` | setting | Enable continuous rocking of the camera. | implemented | [doc](features/settings/_batch-02.md#rock) |
| `rock_delay` | setting | Rock cycle period/delay in units of time. | unknown | [doc](features/settings/_batch-02.md#rock) |
| `roving_byres` | setting | Expand roving selection to whole residues. | unknown | [doc](features/settings/_batch-02.md#roving) |
| `roving_cartoon` | setting | Roving-region cartoon radius (0 = off). | unknown | [doc](features/settings/_batch-02.md#roving) |
| `roving_delay` | setting | Idle delay before roving update fires. | unknown | [doc](features/settings/_batch-02.md#roving) |
| `roving_detail` | setting | Enable roving detail (auto reps near the origin). | unknown | [doc](features/settings/_batch-02.md#roving) |
| `roving_isomesh` | setting | Roving isomesh display radius. | unknown | [doc](features/settings/_batch-02.md#roving) |
| `roving_isosurface` | setting | Roving isosurface display radius (0 = off). | unknown | [doc](features/settings/_batch-02.md#roving) |
| `roving_labels` | setting | Roving label display radius (0 = off). | unknown | [doc](features/settings/_batch-02.md#roving) |
| `roving_lines` | setting | Roving lines display radius. | unknown | [doc](features/settings/_batch-02.md#roving) |
| `roving_map1_level` | setting | Contour level for roving map slot 1. | unknown | [doc](features/settings/_batch-02.md#roving) |
| `roving_map1_name` | setting | Map object name for roving slot 1. | unknown | [doc](features/settings/_batch-02.md#roving) |
| `roving_map2_level` | setting | Contour level for roving map slot 2. | unknown | [doc](features/settings/_batch-02.md#roving) |
| `roving_map2_name` | setting | Map object name for roving slot 2. | unknown | [doc](features/settings/_batch-02.md#roving) |
| `roving_map3_level` | setting | Contour level for roving map slot 3. | unknown | [doc](features/settings/_batch-02.md#roving) |
| `roving_map3_name` | setting | Map object name for roving slot 3. | unknown | [doc](features/settings/_batch-02.md#roving) |
| `roving_nb_spheres` | setting | Roving nonbonded-sphere display radius. | unknown | [doc](features/settings/_batch-02.md#roving) |
| `roving_nonbonded` | setting | Roving nonbonded display radius (0 = off). | unknown | [doc](features/settings/_batch-02.md#roving) |
| `roving_origin` | setting | Recenter the roving origin on camera moves. | unknown | [doc](features/settings/_batch-02.md#roving) |
| `roving_origin_z` | setting | Include Z when computing the roving origin. | unknown | [doc](features/settings/_batch-02.md#roving) |
| `roving_origin_z_cushion` | setting | Z cushion distance around the roving origin. | unknown | [doc](features/settings/_batch-02.md#roving) |
| `roving_polar_contacts` | setting | Roving polar-contact display radius. | unknown | [doc](features/settings/_batch-02.md#roving) |
| `roving_polar_cutoff` | setting | Distance cutoff for roving polar contacts. | unknown | [doc](features/settings/_batch-02.md#roving) |
| `roving_ribbon` | setting | Roving ribbon display radius (negative = off/behind). | unknown | [doc](features/settings/_batch-02.md#roving) |
| `roving_selection` | setting | Named selection roving reps are applied within. | unknown | [doc](features/settings/_batch-02.md#roving) |
| `roving_spheres` | setting | Roving sphere display radius (0 = off). | unknown | [doc](features/settings/_batch-02.md#roving) |
| `roving_sticks` | setting | Roving sticks display radius. | unknown | [doc](features/settings/_batch-02.md#roving) |
| `salt_bridge_distance` | setting | Max distance defining a salt bridge. | unknown | [doc](features/settings/_batch-02.md#measurement) |
| `scene_animation` | setting | Animate transitions between scenes (-1 = follow animation). | unknown | [doc](features/settings/_batch-02.md#scene) |
| `scene_current_name` | setting | Name of the currently active scene. | unknown | [doc](features/settings/_batch-02.md#scene) |
| `scene_frame_mode` | setting | How scenes bind to movie frames (-1 = auto). | unknown | [doc](features/settings/_batch-02.md#scene) |
| `scene_loop` | setting | Loop back to the first scene after the last. | unknown | [doc](features/settings/_batch-02.md#scene) |
| `scene_restart_movie_delay` | setting | Restart the movie after a scene delay. | unknown | [doc](features/settings/_batch-02.md#scene) |
| `scenes_changed` | setting | Internal dirty flag: scene list has changed. | unknown | [doc](features/settings/_batch-02.md#scene) |
| `sculpt_auto_center` | setting | Auto-recenter the model during sculpting. | unknown | [doc](features/settings/_batch-02.md#sculpt) |
| `sculpt_line_weight` | setting | Force weight for planar/line restraints. | unknown | [doc](features/settings/_batch-02.md#sculpt) |
| `sculpt_max_weight` | setting | Force weight for the max (repulsive cap) term. | unknown | [doc](features/settings/_batch-02.md#sculpt) |
| `sculpt_pyra_inv_weight` | setting | Force weight against chiral (pyramid) inversion. | unknown | [doc](features/settings/_batch-02.md#sculpt) |
| `sculpt_vdw_scale14` | setting | VDW radius scale for 1-4 (torsion-adjacent) pairs. | unknown | [doc](features/settings/_batch-02.md#sculpt) |
| `sdf_write_zero_order_bonds` | setting | Encode zero-order bonds when writing SDF/MOL. | unknown | [doc](features/settings/_batch-02.md#fileio) |
| `sdof_drag_scale` | setting | SpaceNavigator drag sensitivity scale. | unknown | [doc](features/settings/_batch-03.md#sdof) |
| `secondary_structure` | setting | Secondary-structure assignment source/mode on load. | unknown | [doc](features/settings/_batch-03.md#secondary-structure) |
| `security` | setting | Guards execution of embedded/scripted code. | unknown | [doc](features/settings/_batch-03.md#system) |
| `sel_counter` | setting | Internal counter for auto-named selections. | internal | [doc](features/settings/_batch-03.md#system) |
| `selection_overlay` | setting | Draw selection indicators in front of geometry. | unknown | [doc](features/settings/_batch-03.md#selection-display) |
| `selection_round_points` | setting | Render selection indicators as round points. | unknown | [doc](features/settings/_batch-03.md#selection-display) |
| `selection_visible_only` | setting | Only indicate atoms currently displayed. | unknown | [doc](features/settings/_batch-03.md#selection-display) |
| `selection_width` | setting | Base pixel size of selection indicator dots. | unknown | [doc](features/settings/_batch-03.md#selection-display) |
| `selection_width_max` | setting | Upper clamp for scaled selection dot size. | unknown | [doc](features/settings/_batch-03.md#selection-display) |
| `selection_width_scale` | setting | Zoom-dependent scale factor for selection dots. | unknown | [doc](features/settings/_batch-03.md#selection-display) |
| `seq_view_alignment` | setting | Named alignment object driving aligned rows. | unknown | [doc](features/settings/_batch-03.md#sequence-view) |
| `seq_view_color` | setting | Sequence text color. | unknown | [doc](features/settings/_batch-03.md#sequence-view) |
| `seq_view_discrete_by_state` | setting | Treat multi-state objects as discrete rows. | unknown | [doc](features/settings/_batch-03.md#sequence-view) |
| `seq_view_fill_char` | setting | Character used to pad gaps. | unknown | [doc](features/settings/_batch-03.md#sequence-view) |
| `seq_view_fill_color` | setting | Color index for gap fill characters. | unknown | [doc](features/settings/_batch-03.md#sequence-view) |
| `seq_view_gap_mode` | setting | How alignment gaps are drawn/collapsed. | unknown | [doc](features/settings/_batch-03.md#sequence-view) |
| `seq_view_label_color` | setting | Color of the sequence row labels. | unknown | [doc](features/settings/_batch-03.md#sequence-view) |
| `seq_view_label_mode` | setting | What labels accompany rows. | unknown | [doc](features/settings/_batch-03.md#sequence-view) |
| `seq_view_label_spacing` | setting | Residue-number label interval. | unknown | [doc](features/settings/_batch-03.md#sequence-view) |
| `seq_view_label_start` | setting | First residue number shown as a label. | unknown | [doc](features/settings/_batch-03.md#sequence-view) |
| `seq_view_location` | setting | Viewer placement (bottom/top). | unknown | [doc](features/settings/_batch-03.md#sequence-view) |
| `seq_view_overlay` | setting | Overlay the sequence on the 3D view. | unknown | [doc](features/settings/_batch-03.md#sequence-view) |
| `seq_view_unaligned_color` | setting | Color for residues outside the alignment. | unknown | [doc](features/settings/_batch-03.md#sequence-view) |
| `seq_view_unaligned_mode` | setting | How unaligned residues are shown. | unknown | [doc](features/settings/_batch-03.md#sequence-view) |
| `session_cache_optimize` | setting | Optimise/dedup cached data on session save. | unknown | [doc](features/settings/_batch-03.md#session) |
| `session_changed` | setting | Dirty flag when session diverges from file. | internal | [doc](features/settings/_batch-03.md#session) |
| `session_compression` | setting | Compress session payloads on save. | unknown | [doc](features/settings/_batch-03.md#session) |
| `session_embeds_data` | setting | Embed loaded map/data blobs into the session. | unknown | [doc](features/settings/_batch-03.md#session) |
| `session_file` | setting | Path of the last loaded/saved session. | internal | [doc](features/settings/_batch-03.md#session) |
| `session_migration` | setting | Upgrade older-version session data on load. | unknown | [doc](features/settings/_batch-03.md#session) |
| `session_version_check` | setting | Warn on session version mismatch. | unknown | [doc](features/settings/_batch-03.md#session) |
| `shaders_from_disk` | setting | Load shader source from disk instead of compiled-in. | unknown | [doc](features/settings/_batch-03.md#shaders) |
| `show_alpha_checker` | setting | Checkerboard behind transparent-background renders. | unknown | [doc](features/settings/_batch-03.md#display-feedback) |
| `show_frame_rate` | setting | Overlay a live FPS counter. | unknown | [doc](features/settings/_batch-03.md#display-feedback) |
| `show_progress` | setting | Show progress bars for long operations. | unknown | [doc](features/settings/_batch-03.md#display-feedback) |
| `single_image` | setting | Hold a single static image (no continuous redraw). | unknown | [doc](features/settings/_batch-03.md#display-feedback) |
| `slice_dynamic_grid` | setting | Recompute slice sampling grid dynamically. | unknown | [doc](features/settings/_batch-03.md#slice) |
| `slice_dynamic_grid_resolution` | setting | Grid resolution for dynamic slice gridding. | unknown | [doc](features/settings/_batch-03.md#slice) |
| `slice_grid` | setting | Static slice sampling spacing. | unknown | [doc](features/settings/_batch-03.md#slice) |
| `slice_height_map` | setting | Render the slice as a height field. | unknown | [doc](features/settings/_batch-03.md#slice) |
| `slice_height_scale` | setting | Vertical exaggeration of the height map. | unknown | [doc](features/settings/_batch-03.md#slice) |
| `slice_track_camera` | setting | Keep the slice plane facing the camera. | unknown | [doc](features/settings/_batch-03.md#slice) |
| `slow_idle` | setting | Idle threshold before slow-idle work runs. | unknown | [doc](features/settings/_batch-03.md#system) |
| `smooth_color_triangle` | setting | Gouraud-interpolate color across ray triangles. | unknown | [doc](features/settings/_batch-03.md#rendering) |
| `smooth_half_bonds` | setting | Blend the two half-bond colors across midpoint. | unknown | [doc](features/settings/_batch-03.md#rendering) |
| `solvent_radius` | setting | Probe radius for solvent/molecular surfaces. | implemented | [doc](features/settings/_batch-03.md#surface-solvent-radius) |
| `spec_direct` | setting | Direct specular contribution toward camera. | unknown | [doc](features/settings/_batch-03.md#lighting) |
| `spec_direct_power` | setting | Exponent for the direct specular term. | unknown | [doc](features/settings/_batch-03.md#lighting) |
| `sphere_color` | setting | Sphere color override. | implemented | [doc](features/settings/_batch-03.md#sphere) |
| `sphere_mode` | setting | Sphere draw path (impostor vs geometry). | unknown | [doc](features/settings/_batch-03.md#sphere) |
| `sphere_point_max_size` | setting | Max pixel size for point-mode spheres. | unknown | [doc](features/settings/_batch-03.md#sphere) |
| `sphere_point_size` | setting | Base point size for point-mode spheres. | unknown | [doc](features/settings/_batch-03.md#sphere) |
| `sphere_quality` | setting | Sphere tessellation subdivision level. | unknown | [doc](features/settings/_batch-03.md#sphere) |
| `sphere_scale` | setting | Multiplier on VDW radius for sphere rep. | implemented | [doc](features/settings/_batch-03.md#sphere) |
| `sphere_solvent` | setting | Add the solvent radius to sphere radii. | unknown | [doc](features/settings/_batch-03.md#sphere) |
| `sphere_transparency` | setting | Per-atom sphere transparency. | implemented | [doc](features/settings/_batch-03.md#sphere) |
| `sphere_use_shader` | setting | Use shader impostor path for spheres. | unknown | [doc](features/settings/_batch-03.md#sphere) |
| `spheroid_fill` | setting | Fill factor for spheroid density fitting. | unknown | [doc](features/settings/_batch-03.md#spheroid) |
| `spheroid_scale` | setting | Overall spheroid size multiplier. | unknown | [doc](features/settings/_batch-03.md#spheroid) |
| `spheroid_smooth` | setting | Smoothing applied to spheroid surface. | unknown | [doc](features/settings/_batch-03.md#spheroid) |
| `ss_helix_phi_exclude` | setting | φ half-window beyond which helix is rejected. | unknown | [doc](features/settings/_batch-03.md#secondary-structure) |
| `ss_helix_phi_include` | setting | φ half-window fully counting as helix. | unknown | [doc](features/settings/_batch-03.md#secondary-structure) |
| `ss_helix_phi_target` | setting | Ideal helix φ angle. | unknown | [doc](features/settings/_batch-03.md#secondary-structure) |
| `ss_helix_psi_exclude` | setting | ψ helix exclude half-window. | unknown | [doc](features/settings/_batch-03.md#secondary-structure) |
| `ss_helix_psi_include` | setting | ψ helix include half-window. | unknown | [doc](features/settings/_batch-03.md#secondary-structure) |
| `ss_helix_psi_target` | setting | Ideal helix ψ angle. | unknown | [doc](features/settings/_batch-03.md#secondary-structure) |
| `ss_strand_phi_exclude` | setting | φ strand exclude half-window. | unknown | [doc](features/settings/_batch-03.md#secondary-structure) |
| `ss_strand_phi_include` | setting | φ strand include half-window. | unknown | [doc](features/settings/_batch-03.md#secondary-structure) |
| `ss_strand_phi_target` | setting | Ideal β-strand φ angle. | unknown | [doc](features/settings/_batch-03.md#secondary-structure) |
| `ss_strand_psi_exclude` | setting | ψ strand exclude half-window. | unknown | [doc](features/settings/_batch-03.md#secondary-structure) |
| `ss_strand_psi_include` | setting | ψ strand include half-window. | unknown | [doc](features/settings/_batch-03.md#secondary-structure) |
| `ss_strand_psi_target` | setting | Ideal β-strand ψ angle. | unknown | [doc](features/settings/_batch-03.md#secondary-structure) |
| `state` | setting | Current/displayed object state. | implemented | [doc](features/settings/_batch-03.md#states) |
| `state_counter_mode` | setting | On-screen state counter format. | unknown | [doc](features/settings/_batch-03.md#states) |
| `stereo` | setting | Master stereo toggle. | unknown | [doc](features/settings/_batch-03.md#stereo) |
| `stereo_angle` | setting | Stereo convergence/toe-in angle. | unknown | [doc](features/settings/_batch-03.md#stereo) |
| `stereo_double_pump_mono` | setting | Double-pump a mono buffer for stereo hardware. | unknown | [doc](features/settings/_batch-03.md#stereo) |
| `stereo_dynamic_strength` | setting | Strength of dynamic-depth stereo modes. | unknown | [doc](features/settings/_batch-03.md#stereo) |
| `stereo_mode` | setting | Stereo method (1..13; 2=cross-eye). | unknown | [doc](features/settings/_batch-03.md#stereo) |
| `stereo_shift` | setting | Camera separation shift for stereo pairs. | unknown | [doc](features/settings/_batch-03.md#stereo) |
| `stick_as_cylinders` | setting | Draw sticks as true cylinders. | unknown | [doc](features/settings/_batch-03.md#stick) |
| `stick_ball` | setting | Enable ball-and-stick. | implemented | [doc](features/settings/_batch-03.md#stick) |
| `stick_ball_color` | setting | Ball color override in ball-and-stick. | unknown | [doc](features/settings/_batch-03.md#stick) |
| `stick_ball_ratio` | setting | Ball radius relative to stick radius. | implemented | [doc](features/settings/_batch-03.md#stick) |
| `stick_color` | setting | Stick color override. | implemented | [doc](features/settings/_batch-03.md#stick) |
| `stick_debug` | setting | Draw debug geometry for stick generation. | internal | [doc](features/settings/_batch-03.md#stick) |
| `stick_fixed_radius` | setting | Use a fixed stick radius (no scaling). | unknown | [doc](features/settings/_batch-03.md#stick) |
| `stick_good_geometry` | setting | Prefer higher-quality stick joins. | unknown | [doc](features/settings/_batch-03.md#stick) |
| `stick_h_scale` | setting | Radius scale for bonds to hydrogens. | implemented | [doc](features/settings/_batch-03.md#stick) |
| `stick_nub` | setting | Length of the capping nub at open stick ends. | unknown | [doc](features/settings/_batch-03.md#stick) |
| `stick_overlap` | setting | Overlap between stick segments to hide seams. | unknown | [doc](features/settings/_batch-03.md#stick) |
| `stick_quality` | setting | Cylinder tessellation for sticks. | unknown | [doc](features/settings/_batch-03.md#stick) |
| `stick_radius` | setting | Stick cylinder radius. | implemented | [doc](features/settings/_batch-03.md#stick) |
| `stick_round_nub` | setting | Round rather than flat stick end caps. | unknown | [doc](features/settings/_batch-03.md#stick) |
| `stick_transparency` | setting | Per-bond stick transparency. | implemented | [doc](features/settings/_batch-03.md#stick) |
| `stick_use_shader` | setting | Use shader cylinder path for sticks. | unknown | [doc](features/settings/_batch-03.md#stick) |
| `stick_valence_scale` | setting | Spacing scale for multiple-bond valence lines. | unknown | [doc](features/settings/_batch-03.md#stick) |
| `stop_on_exceptions` | setting | Halt command execution on a Python exception. | unknown | [doc](features/settings/_batch-03.md#system) |
| `suppress_hidden` | setting | Skip hidden reps when composing geometry. | unknown | [doc](features/settings/_batch-03.md#display-feedback) |
| `surface_best` | setting | Triangle spacing at the best quality preset. | unknown | [doc](features/settings/_batch-03.md#surface) |
| `surface_carve_cutoff` | setting | Carve radius around the carve selection. | unknown | [doc](features/settings/_batch-03.md#surface) |
| `surface_carve_normal_cutoff` | setting | Normal-alignment cutoff for carving. | unknown | [doc](features/settings/_batch-03.md#surface) |
| `surface_carve_selection` | setting | Selection the surface is carved to. | unknown | [doc](features/settings/_batch-03.md#surface) |
| `surface_carve_state` | setting | State providing the carve selection. | unknown | [doc](features/settings/_batch-03.md#surface) |
| `surface_cavity_cutoff` | setting | Cavity detection cutoff. | unknown | [doc](features/settings/_batch-03.md#surface) |
| `surface_cavity_mode` | setting | Cavity display mode (exterior/cavities/culled). | unknown | [doc](features/settings/_batch-03.md#surface) |
| `surface_cavity_radius` | setting | Cavity detection probe radius. | unknown | [doc](features/settings/_batch-03.md#surface) |
| `surface_circumscribe` | setting | Extra circumscribing pass control. | unknown | [doc](features/settings/_batch-03.md#surface) |
| `surface_clear_cutoff` | setting | Clear radius around the clear selection. | unknown | [doc](features/settings/_batch-03.md#surface) |
| `surface_clear_selection` | setting | Selection cleared from the surface. | unknown | [doc](features/settings/_batch-03.md#surface) |
| `surface_clear_state` | setting | State providing the clear selection. | unknown | [doc](features/settings/_batch-03.md#surface) |
| `surface_color` | setting | Surface color override. | implemented | [doc](features/settings/_batch-03.md#surface) |
| `surface_color_smoothing` | setting | Smooth per-vertex surface colors. | unknown | [doc](features/settings/_batch-03.md#surface) |
| `surface_color_smoothing_threshold` | setting | Color-difference threshold for smoothing. | unknown | [doc](features/settings/_batch-03.md#surface) |
| `surface_debug` | setting | Emit surface-generation debug geometry. | internal | [doc](features/settings/_batch-03.md#surface) |
| `surface_miserable` | setting | Triangle spacing at the coarsest preset. | unknown | [doc](features/settings/_batch-03.md#surface) |
| `surface_mode` | setting | Atom-inclusion mode for surfacing. | unknown | [doc](features/settings/_batch-03.md#surface) |
| `surface_negative_color` | setting | Color for the negative side of a signed surface. | unknown | [doc](features/settings/_batch-03.md#surface) |
| `surface_negative_visible` | setting | Show the negative-value surface lobe. | unknown | [doc](features/settings/_batch-03.md#surface) |
| `surface_normal` | setting | Normal-vector smoothing radius. | unknown | [doc](features/settings/_batch-03.md#surface) |
| `surface_optimize_subsets` | setting | Optimise surfacing of selected subsets. | unknown | [doc](features/settings/_batch-03.md#surface) |
| `surface_poor` | setting | Triangle spacing at the poor quality preset. | unknown | [doc](features/settings/_batch-03.md#surface) |
| `surface_proximity` | setting | Require edge/vertex proximity when trimming. | unknown | [doc](features/settings/_batch-03.md#surface) |
| `surface_quality` | setting | Surface quality tier selector. | implemented | [doc](features/settings/_batch-03.md#surface) |
| `surface_ramp_above_mode` | setting | Ramp behaviour above the color threshold. | unknown | [doc](features/settings/_batch-03.md#surface) |
| `surface_residue_cutoff` | setting | Distance cutoff grouping residues into a patch. | unknown | [doc](features/settings/_batch-03.md#surface) |
| `surface_smooth_edges` | setting | Smooth surface patch boundaries. | unknown | [doc](features/settings/_batch-03.md#surface) |
| `surface_solvent` | setting | Compute a solvent-accessible surface. | unknown | [doc](features/settings/_batch-03.md#surface) |
| `surface_trim_cutoff` | setting | Cutoff for trimming small surface fragments. | unknown | [doc](features/settings/_batch-03.md#surface) |
| `surface_trim_factor` | setting | Aggressiveness of surface trimming. | unknown | [doc](features/settings/_batch-03.md#surface) |
| `surface_type` | setting | Surface style (solid/dot/wireframe). | implemented | [doc](features/settings/_batch-03.md#surface) |
| `surface_use_shader` | setting | Use shader path for surface rendering. | unknown | [doc](features/settings/_batch-03.md#surface) |
| `suspend_deferred` | setting | Suspend deferred builds/updates processing. | internal | [doc](features/settings/_batch-03.md#system) |
| `suspend_undo` | setting | Suspend undo capture. | internal | [doc](features/settings/_batch-03.md#system) |
| `suspend_undo_atom_count` | setting | Auto-suspend undo above this atom count. | internal | [doc](features/settings/_batch-03.md#system) |
| `suspend_updates` | setting | Freeze scene/geometry updates. | internal | [doc](features/settings/_batch-03.md#system) |
| `swap_dsn6_bytes` | setting | Byte-swap DSN6/BRIX map files on load. | unknown | [doc](features/settings/_batch-03.md#swap-dsn6) |
| `sweep_angle` | setting | Amplitude of the sweep/rock in degrees. | unknown | [doc](features/settings/_batch-03.md#sweep) |
| `sweep_mode` | setting | Sweep axis/pattern selector. | unknown | [doc](features/settings/_batch-03.md#sweep) |
| `sweep_phase` | setting | Phase offset of the sweep cycle. | unknown | [doc](features/settings/_batch-03.md#sweep) |
| `sweep_speed` | setting | Sweep oscillation speed. | unknown | [doc](features/settings/_batch-03.md#sweep) |
| `test1` | setting | Scratch float for engine test/debug paths. | internal | [doc](features/settings/_batch-03.md#debug) |
| `test2` | setting | Scratch float for engine test/debug paths. | internal | [doc](features/settings/_batch-03.md#debug) |
| `text` | setting | Text-only/debug rendering toggle. | unknown | [doc](features/settings/_batch-03.md#debug) |
| `trace_atoms_mode` | setting | Which atoms define the trace/sequence row. | unknown | [doc](features/settings/_batch-03.md#sequence-view) |
| `transparency` | setting | Surface transparency (atom-level). | implemented | [doc](features/settings/_batch-03.md#transparency) |
| `transparency_global_sort` | setting | Depth-sort transparent geometry globally. | unknown | [doc](features/settings/_batch-03.md#transparency) |
| `transparency_mode` | setting | Transparency blending method. | unknown | [doc](features/settings/_batch-03.md#transparency) |
| `transparency_picking_mode` | setting | Picking behaviour through transparent surfaces. | unknown | [doc](features/settings/_batch-03.md#transparency) |
| `triangle_max_passes` | setting | Max smoothing passes for triangle meshes. | unknown | [doc](features/settings/_batch-03.md#rendering) |
| `trilines` | setting | Use triangle-based thick line rendering. | unknown | [doc](features/settings/_batch-03.md#rendering) |
| `trim_dots` | setting | Trim dot-surface dots inside neighbouring atoms. | unknown | [doc](features/settings/_batch-03.md#dots) |
| `use_geometry_shaders` | setting | Permit geometry-shader draw paths. | unknown | [doc](features/settings/_batch-03.md#shaders) |
| `use_shaders` | setting | Master shader-path toggle. | unknown | [doc](features/settings/_batch-03.md#shaders) |
| `use_tessellation_shaders` | setting | Permit tessellation-shader draw paths. | unknown | [doc](features/settings/_batch-03.md#shaders) |
| `valence` | setting | Draw multiple bonds as multiple lines. | implemented | [doc](features/settings/_batch-03.md#valence) |
| `valence_mode` | setting | Valence-line placement algorithm. | unknown | [doc](features/settings/_batch-03.md#valence) |
| `valence_size` | setting | Offset spacing between valence lines. | unknown | [doc](features/settings/_batch-03.md#valence) |
| `valence_zero_mode` | setting | Zero-order bond style (skip/dashed/solid). | unknown | [doc](features/settings/_batch-03.md#valence) |
| `valence_zero_scale` | setting | Radius/scale for zero-order bond sticks. | unknown | [doc](features/settings/_batch-03.md#valence) |
| `validate_object_names` | setting | Reject/normalise illegal object-name characters. | unknown | [doc](features/settings/_batch-03.md#system) |
| `virtual_trackball` | setting | Use virtual-trackball rotation mapping. | unknown | [doc](features/settings/_batch-03.md#camera) |
| `volume_bit_depth` | setting | Texture bit depth for the volume. | unknown | [doc](features/settings/_batch-03.md#volume) |
| `volume_data_range` | setting | Data value range mapped by transfer function. | unknown | [doc](features/settings/_batch-03.md#volume) |
| `volume_layers` | setting | Number of sampling slabs through the volume. | unknown | [doc](features/settings/_batch-03.md#volume) |
| `volume_mode` | setting | Volume rendering path. | unknown | [doc](features/settings/_batch-03.md#volume) |
| `wildcard` | setting | Wildcard character in selection matching. | unknown | [doc](features/settings/_batch-03.md#wildcard) |
| `wizard_prompt_mode` | setting | How wizard prompts are surfaced in the GUI. | unknown | [doc](features/settings/_batch-03.md#wizard) |
| `wrap_output` | setting | Word-wrap text in the output feedback pane. | unknown | [doc](features/settings/_batch-03.md#system) |

## symmetry (12)

| Feature | Kind | Summary | Parity | Doc |
| --- | --- | --- | --- | --- |
| `get_assembly_ids` `get_assembly_ids(name, quiet=1)` | command | Experimental: returns the list of biological-assembly ids from an mmCIF-loaded object. | partial | [doc](features/topics/symmetry-crystallography.md#get_assembly_ids) |
| `get_symmetry` `get_symmetry(selection='(all)', state=-1, quiet=1)` | command | Returns a molecule or map's crystal cell and space group as [a,b,c,alpha,beta,gamma,spacegroup]. | implemented | [doc](features/topics/symmetry-crystallography.md#get_symmetry) |
| `pbc_unwrap` `pbc_unwrap(oname, bymol=True)` | command | Unwraps atoms or molecules so they stop jumping across periodic boundaries in a trajectory. | planned | [doc](features/topics/symmetry-crystallography.md#pbc_unwrap) |
| `pbc_wrap` `pbc_wrap(oname, center=None)` | command | Wraps molecules by whole lattice vectors back into the periodic (PBC) box. | planned | [doc](features/topics/symmetry-crystallography.md#pbc_wrap) |
| `set_symmetry` `set_symmetry(selection, a, b, c, alpha, beta, gamma, spacegroup='P1', state=-1, quiet=1)` | command | Defines or redefines the crystal cell parameters and space group for a molecule or map object. | implemented | [doc](features/topics/symmetry-crystallography.md#set_symmetry) |
| `symexp` `symexp(prefix, object, selection, cutoff, segi=0, quiet=1)` | command | Creates every space-group and lattice symmetry mate of an object that falls within a cutoff of an atom selection, as fresh prefix## objects. | implemented | [doc](features/topics/symmetry-crystallography.md#symexp) |
| `symmetry_copy` `symmetry_copy(source_name, target_name, source_state=1, target_state=1, quiet=1)` | command | Copies symmetry information (unit cell and space group) from one object to another. | implemented | [doc](features/commands/symmetry_copy.md) |
| `space groups` | feature | The table of Hermann-Mauguin space-group symmetry operators used to tile the unit cell; the TS port covers P1, P2, P2-1, P2-1-2-1-2-1 and C2 with a P1 identity fallback. | partial | [doc](features/topics/symmetry-crystallography.md#space-groups) |
| `cell` | representation | Wireframe representation of the crystallographic unit-cell box and its a/b/c axes, drawn from the object's cell parameters. | partial | [doc](features/topics/symmetry-crystallography.md#cell) |
| `assembly` | setting | Selects which biological assembly to generate when loading an mmCIF file; empty loads the asymmetric unit as-is. | planned | [doc](features/topics/symmetry-crystallography.md#assembly) |
| `cell_centered` | setting | When true, draws the unit-cell box centered on the origin instead of anchored at the (0,0,0) corner. | partial | [doc](features/topics/symmetry-crystallography.md#cell_centered) |
| `cell_color` | setting | Color of the unit-cell representation box; -1 uses the object color. | partial | [doc](features/topics/symmetry-crystallography.md#cell_color) |

## ui-gui (60)

| Feature | Kind | Summary | Parity | Doc |
| --- | --- | --- | --- | --- |
| `button` `button(button, modifier, action)` | command | Redefines what a mouse button plus modifier does in the current mouse mode. | implemented | [doc](features/topics/ui-input-dialogs.md#button) |
| `config_mouse` `config_mouse(ring='three_button', quiet=1)` | command | Sets the active mouse configuration ring (three-button, two-button, one-button, maestro, motions, all-modes). | implemented | [doc](features/topics/ui-input-dialogs.md#config_mouse) |
| `edit_mode` `edit_mode(active=1, quiet=1)` | command | Toggles the mouse between the viewing and editing variant of the current mode family. | implemented | [doc](features/topics/ui-input-dialogs.md#edit_mode) |
| `editing_ring` `editing_ring(action)` | command | Clipboard-ring helper for copy/cut/paste/invert of molecular selections, backing CTRL-C/X/V/I. | implemented | [doc](features/topics/ui-input-dialogs.md#editing_ring) |
| `mouse` `mouse(action=None, quiet=1)` | command | Cycles through or jumps to the mouse modes of the current configuration ring, or steps the selection level. | implemented | [doc](features/topics/ui-input-dialogs.md#mouse) |
| `set_key` `set_key(key, fn=None, arg=(), kw={})` | command | Binds a Python function or command string to a redefinable key (F-keys, arrows, CTRL/ALT/CTSH letters). | implemented | [doc](features/topics/ui-input-dialogs.md#set_key) |
| `splash` `splash(mode=0)` | command | Shows the PyMOL splash screen / startup information. | implemented | [doc](features/commands/splash.md) |
| `A action menu` | feature | The per-row A (Action) toggle button opening a type-specific pymol.menu action menu (all_action/sele_action/mol_action/group_action/map_action/etc.). | implemented | [doc](features/topics/ui-main-internal.md#a-button-action-menu) |
| `Advanced Settings editor` | feature | Modeless filterable table of every setting for reading and editing values by name. | implemented | [doc](features/topics/ui-input-dialogs.md#advanced-settings-editor) |
| `ALT-attach bindings` | feature | ALT-digit and ALT-letter defaults that grow fragments and attach amino acids onto pk1 from the keyboard. | implemented | [doc](features/topics/ui-input-dialogs.md#alt-attach-bindings) |
| `Builder dialog` | feature | Floating molecular-builder dock with Chemical/Protein/Nucleic tabs and always-visible editing action rows, arming action wizards on unpicked state. | implemented | [doc](features/topics/ui-input-dialogs.md#builder-dialog) |
| `busy-progress-box` | feature | The in-viewport busy/progress box (OrthoBusyDraw): a top-left message box with up to two progress bars gated by show_progress. | implemented | [doc](features/topics/ui-main-internal.md#busy-and-progress-box) |
| `butmode-block` | feature | The ButMode mouse-mode indicator block: mode name line, optional key/button matrix, selection-mode line, frame-rate line, and click-to-cycle behaviour. | implemented | [doc](features/topics/ui-main-internal.md#butmode-mouse-mode-block) |
| `C color menu` | feature | The per-row C (Color) rainbow toggle button opening mol_color (by element/chain/ss/rep/spectrum + full palette) or general/mesh/measurement/slice/vol/ramp color variants. | implemented | [doc](features/topics/ui-main-internal.md#c-button-color-menu) |
| `command-history` | feature | The 255-entry command history ring with a slot-0 scratch buffer, dedup on submit, and Ctrl+Up prefix back-search. | implemented | [doc](features/topics/ui-main-internal.md#command-history) |
| `command-line` | feature | The CommandLineEdit input area (PyMOL> prompt) with Tab/Up/Down/Ctrl+Up/Enter key handling and live drag-and-drop text preview. | implemented | [doc](features/topics/ui-main-internal.md#command-line) |
| `CTRL-letter bindings` | feature | Default CTRL-A..Z shortcuts for select-all, clipboard ring, wizards, ligand zoom, bond, and undo/redo. | implemented | [doc](features/topics/ui-input-dialogs.md#ctrl-letter-bindings) |
| `CTSH-letter editing bindings` | feature | Ctrl+Shift+letter defaults for element replacement, charge, valence, hydrogen fill, and undo/redo on the current pick. | implemented | [doc](features/topics/ui-input-dialogs.md#ctsh-letter-editing-bindings) |
| `external-gui-dock` | feature | The merged External GUI QDockWidget holding the feedback panel, command line and quick buttons, with a Ctrl+E dockable toggle. | implemented | [doc](features/topics/ui-main-internal.md#external-gui-dock) |
| `feedback-output-panel` | feature | The read-only monospace QPlainTextEdit output log, polled every 500ms to drain the feedback queue and sync setting-driven menu items. | implemented | [doc](features/topics/ui-main-internal.md#feedback-output-panel) |
| `Function-key scene bindings` | feature | CTRL-Fn / CTSH-Fn store scenes into F1..F12 slots; bare Fn recalls them via scene/view name lookup. | implemented | [doc](features/topics/ui-input-dialogs.md#function-key-scene-bindings) |
| `group-control` | feature | The group open/close [+]/[-] control at a group row head, logging cmd.group(name, action=open\|close) and hosting drag reorder/regroup. | implemented | [doc](features/topics/ui-main-internal.md#group-open-and-close-control) |
| `H hide menu` | feature | The per-row H (Hide) toggle button opening the representation hide menu, the mirror of the show menu. | implemented | [doc](features/topics/ui-main-internal.md#h-button-hide-menu) |
| `Keyboard Shortcut editor` | feature | Modeless table of every key binding with create/delete/reset/save, backing the set_key map. | implemented | [doc](features/topics/ui-input-dialogs.md#keyboard-shortcut-editor) |
| `L label menu` | feature | The per-row L (Label) toggle button opening the mol_labels menu (residues/chains/atom name/b-factor/other properties/atom identifiers); absent for map/mesh/surface/slice rows. | implemented | [doc](features/topics/ui-main-internal.md#l-button-label-menu) |
| `M motion menu` | feature | The optional per-row M (Motion) toggle button (present only in 3-Button Motions mode) opening camera_motion or obj_motion for movie key-frame editing. | implemented | [doc](features/topics/ui-main-internal.md#m-button-motion-menu) |
| `main-window` | feature | The Qt QMainWindow shell (PyMOLQtGUI) hosting the viewport, docks, title tracking session_file, and full-screen toggle. | implemented | [doc](features/topics/ui-main-internal.md#main-window-shell) |
| `menu-bar` | feature | The top menu bar (File/Edit/Build/Movie/Display/Setting/Scene/Mouse/Wizard/Plugin/Help) built from the get_menudata data model via the _addmenu grammar. | implemented | [doc](features/topics/ui-main-internal.md#menu-bar) |
| `Mouse action codes` | feature | The ButMode action vocabulary (rotate, translate, zoom, clip, pick, select, drag, torsion, center, menu) any button slot can bind to. | implemented | [doc](features/topics/ui-input-dialogs.md#mouse-action-codes) |
| `Mouse wheel bindings` | feature | The wheel slots that drive slab scaling, slab motion, and zoom, resolved by scroll direction. | implemented | [doc](features/topics/ui-input-dialogs.md#mouse-wheel-bindings) |
| `movie-control-bar` | feature | The 9-button movie transport bar (Control block): rewind/back/stop/play/forward/end plus seq_view, rock and full-screen toggles, with a resize/collapse gutter nub. | implemented | [doc](features/topics/ui-main-internal.md#movie-control-bar) |
| `movie-timeline` | feature | The Movie block timeline/scrubber: one ViewElem strip per motion row, a frame scrollbar, and drag gestures for insert/delete/clear/move/copy key frames. | implemented | [doc](features/topics/ui-main-internal.md#movie-timeline-scrubber) |
| `Navigation & movie/scene key bindings` | feature | Default arrow/navigation key bindings (and SHFT/CTRL/ALT/CTSH variants) for movie frames, scenes, and zoom. | implemented | [doc](features/topics/ui-input-dialogs.md#navigation--moviescene-key-bindings) |
| `object-panel` | feature | The internal-GUI names list (Executive block): one row per object/selection/all with name button, caption, indent and ASHLC toggles, plus click/drag visibility and reorder semantics. | implemented | [doc](features/topics/ui-main-internal.md#object-panel-names-list) |
| `one_button_viewing` | feature | Single-button mode where every action stacks modifiers on the left button; only mode using alsh/ctal/ctas. | implemented | [doc](features/topics/ui-input-dialogs.md#one_button_viewing) |
| `open-recent-menu` | feature | The dynamic File > Open Recent submenu repopulated on aboutToShow from a ~/.pymol/recent.db sqlite store. | implemented | [doc](features/topics/ui-main-internal.md#open-recent-submenu) |
| `ortho-command-line` | feature | The command prompt PyMOL draws inside the viewport (OrthoKey): in-viewport typing, editing chords, history recall and Enter/Esc/Space movie shortcuts. | implemented | [doc](features/topics/ui-main-internal.md#ortho-command-line) |
| `ortho-feedback` | feature | The in-viewport feedback/scrollback text (OrthoDrawText) governed by internal_feedback, overlay, overlay_lines, auto_overlay and internal_prompt. | implemented | [doc](features/topics/ui-main-internal.md#ortho-feedback-scrollback) |
| `popup-menu-engine` | feature | The shared viewport popup-menu engine: [code,text,command] model, hover sub-menu delay, sloppy-mousing, passive/sticky menus, wheel scroll and PLog+PParse commit. | implemented | [doc](features/topics/ui-main-internal.md#popup-menu-engine) |
| `progress-bar` | feature | The external-GUI QProgressBar plus red Abort button (cmd.interrupt), shown/hidden by cmd.get_progress on the feedback tick. | implemented | [doc](features/topics/ui-main-internal.md#progress-bar-and-abort) |
| `Properties Inspector` | feature | Modeless tree inspector/editor of object/state/atom fields, settings, and matrices for the picked atom. | implemented | [doc](features/topics/ui-input-dialogs.md#properties-inspector) |
| `quick-buttons` | feature | The external-GUI shortcut-button grid (Reset/Zoom/Orient/Draw-Ray/Unpick/Deselect/Rock/Get View/transport/Builder/Properties/Rebuild). | implemented | [doc](features/topics/ui-main-internal.md#quick-buttons) |
| `S show menu` | feature | The per-row S (Show) toggle button opening the representation show menu (mol_show/cgo_show/map_show/mesh_show/surface_show/etc.). | implemented | [doc](features/topics/ui-main-internal.md#s-button-show-menu) |
| `Scene Panel` | feature | Modeless panel of stored scenes with server-rendered thumbnails; add, update, delete, rename, recall, and reorder. | implemented | [doc](features/topics/ui-input-dialogs.md#scene-panel) |
| `scene-bar` | feature | The in-scene scene buttons (SceneDrawButtons) stacked bottom-left, gated by scene_buttons, with click-recall, middle-click animate, and right-click reorder/menu. | implemented | [doc](features/topics/ui-main-internal.md#scene-bar) |
| `splash` | feature | The version/copyright splash drawn inside the OpenGL viewport by OrthoSplash, dismissed on first click; there is no Qt splash screen. | implemented | [doc](features/topics/ui-main-internal.md#splash) |
| `tab-completion` | feature | Command-line Tab completion against command keywords, per-argument auto_arg lists, and filesystem/$ENVVAR glob fallback. | implemented | [doc](features/topics/ui-main-internal.md#tab-completion) |
| `Text/Python Editor` | feature | Minimal code editor with Python/PML/plain syntax highlighting used to edit pymolrc and script files. | implemented | [doc](features/topics/ui-input-dialogs.md#textpython-editor) |
| `three_button_editing` | feature | Three-button editing mode: Shift/Ctrl rotate objects, torsion fragments, and pick bonds for molecule building. | implemented | [doc](features/topics/ui-input-dialogs.md#three_button_editing) |
| `three_button_lights` | feature | Three-button light mode: Shift+L/M/R edit the direction, position, and Z of the current light. | implemented | [doc](features/topics/ui-input-dialogs.md#three_button_lights) |
| `three_button_maestro` | feature | Maestro-style three-button mode: L box-select, M rotate, R translate. | implemented | [doc](features/topics/ui-input-dialogs.md#three_button_maestro) |
| `three_button_motions` | feature | Three-button motion mode: Shift variants edit TTT/movie view transforms for authoring camera and object motion. | implemented | [doc](features/topics/ui-input-dialogs.md#three_button_motions) |
| `three_button_viewing` | feature | Default three-button mode: L rotate, M translate, R zoom, Shift box-select, single clicks pick/center/menu. | implemented | [doc](features/topics/ui-input-dialogs.md#three_button_viewing) |
| `two_button_editing` | feature | Two-button editing mode: Shift picks atoms, Ctrl sets torsion bonds, Ctrl+Shift rotates fragments. | implemented | [doc](features/topics/ui-input-dialogs.md#two_button_editing) |
| `two_button_lights` | feature | Two-button light-editing mode, reachable only via mouse('two_button_lights'). | implemented | [doc](features/topics/ui-input-dialogs.md#two_button_lights) |
| `two_button_selecting` | feature | Selecting half of the two-button ring: Shift box-add, Ctrl toggle atoms. | implemented | [doc](features/topics/ui-input-dialogs.md#two_button_selecting) |
| `two_button_viewing` | feature | Two-button viewing mode for trackpads: L rotate, R zoom, middle button unused. | implemented | [doc](features/topics/ui-input-dialogs.md#two_button_viewing) |
| `wizard-block` | feature | The wizard panel block rendering get_panel() text/button/popup lines and dispatching PParse(code) or get_menu(code) on click. | implemented | [doc](features/topics/ui-main-internal.md#wizard-block) |
| `wizard-prompt` | feature | The floating wizard prompt overlay drawn from get_prompt(), positioned per wizard_prompt_mode (filled box / text only / top-left corner) with color codes. | implemented | [doc](features/topics/ui-main-internal.md#wizard-prompt-overlay) |
| `selection-indicators` | selection | Visual selection cues: parenthesised selection rows with sele_color, the OrthoDrawLoop rubber-band box, and the picking-mode indicator line. | implemented | [doc](features/topics/ui-main-internal.md#selection-indicators) |

## viewing-camera (39)

| Feature | Kind | Summary | Parity | Doc |
| --- | --- | --- | --- | --- |
| `bg_color` `bg_color(color="black")` | command | Set the scene background colour by name or number. | implemented | [doc](features/topics/viewing-camera.md#bg_color) |
| `bg_colour` `bg_colour(color='black')` | command | British-spelling alias of bg_color; sets the viewport background color. | implemented | [doc](features/commands/bg_colour.md) |
| `center` `center(selection="all", state=0, origin=1, animate=0)` | command | Translate the window, clipping slab and origin to the centre of an atom selection. | implemented | [doc](features/topics/viewing-camera.md#center) |
| `clip` `clip(mode, distance, selection=None, state=0)` | command | Alter the near/far clipping-plane positions via near/far/move/slab/atoms modes. | implemented | [doc](features/topics/viewing-camera.md#clip) |
| `full_screen` `full_screen(toggle=-1)` | command | Enable or disable full-screen mode (GUI-thread bound, platform dependent). | partial | [doc](features/topics/viewing-camera.md#full_screen) |
| `get_clip` `get_clip(quiet=1)` | command | Returns the current positions of the near and far clipping planes. | unknown | [doc](features/commands/get_clip.md) |
| `get_position` `get_position(quiet=1)` | command | Return the 3D coordinates of the center of the viewer window (camera origin of rotation). | implemented | [doc](features/commands/get_position.md) |
| `get_view` `get_view(output=1, quiet=1)` | command | Return (and optionally print) the current 18-float view vector for pasting into a script. | implemented | [doc](features/topics/viewing-camera.md#get_view) |
| `get_viewport` `get_viewport(output=1, quiet=1)` | command | Return (and optionally print) the screen viewport size as (width, height). | implemented | [doc](features/topics/viewing-camera.md#get_viewport) |
| `look_at` `look_at(target_obj, mobile_obj='_Camera')` | command | Rotate an object (or the camera view) so its forward z-axis points at the center of a target object. | implemented | [doc](features/commands/look_at.md) |
| `move` `move(axis, distance)` | command | Translate the camera along one of the three primary axes (a z move carries the clip planes). | implemented | [doc](features/topics/viewing-camera.md#move) |
| `orient` `orient(selection="(all)", state=0, animate=0)` | command | Align the selection's principal components with the XYZ axes and frame it. | implemented | [doc](features/topics/viewing-camera.md#orient) |
| `origin` `origin(selection="(all)", object=None, position=None, state=0)` | command | Set the centre of rotation about a selection, an explicit position, or an object. | implemented | [doc](features/topics/viewing-camera.md#origin) |
| `reset` `reset(object='')` | command | Reset the rotation to identity, origin to centre of mass and zoom to all objects (or reset an object's matrix). | implemented | [doc](features/topics/viewing-camera.md#reset) |
| `rock` `rock(mode=-1)` | command | Toggle live camera rocking (idle-loop sweep/spin/nutate, honouring the sweep_* settings). | implemented | [doc](features/topics/viewing-camera.md#rock) |
| `set_object_ttt` `set_object_ttt(object, ttt, state=0, quiet=1, homogenous=0)` | command | API-only command that sets an object's TTT (view-transformation) matrix. | planned | [doc](features/commands/set_object_ttt.md) |
| `set_view` `set_view(view, animate=0, quiet=1, hand=1)` | command | Restores the full camera state (rotation, position, origin, clipping planes, orthoscopic flag) from an 18-float view sequence. | implemented | [doc](features/commands/set_view.md) |
| `stereo` `stereo(toggle='on', quiet=1)` | command | Activate or deactivate stereo display and choose the stereo mode. | partial | [doc](features/topics/viewing-camera.md#stereo) |
| `turn` `turn(axis, angle)` | command | Rotates the camera about one of the three primary axes, centered at the origin. | implemented | [doc](features/commands/turn.md) |
| `view` `view(key, action='recall', animate=-1)` | command | Store, recall or clear named camera views in a per-session dictionary (F1-F12 fallbacks). | implemented | [doc](features/topics/viewing-camera.md#view) |
| `viewport` `viewport(width=-1, height=-1)` | command | Change the size of the graphics display area (tuple syntax deprecated). | implemented | [doc](features/topics/viewing-camera.md#viewport) |
| `window` `window(action='show', x=0, y=0, width=0, height=0)` | command | Control visibility and geometry of PyMOL's output window (GUI-shell operation). | partial | [doc](features/topics/viewing-camera.md#window) |
| `zoom` `zoom(selection="all", buffer=0.0, state=0, complete=0, animate=0)` | command | Scale and translate the window and origin to cover an atom selection, guessing an optimal zoom level. | implemented | [doc](features/topics/viewing-camera.md#zoom) |
| `depth_cue` | setting | Master switch for the depth-cue fog effect that fades distant geometry. | partial | [doc](features/topics/viewing-camera.md#depth_cue) |
| `field_of_view` | setting | Vertical field of view in degrees; only visible under perspective projection. | implemented | [doc](features/topics/viewing-camera.md#field_of_view) |
| `fog` | setting | Fog density used by the depth-cue effect (0 = none, 1 = full). | implemented | [doc](features/topics/viewing-camera.md#fog) |
| `fog_start` | setting | Where the fog begins, as a fraction between the near and far clip planes. | partial | [doc](features/topics/viewing-camera.md#fog_start) |
| `light_count` | setting | Number of light sources including the camera source (1-10). | partial | [doc](features/topics/viewing-camera.md#light_count) |
| `orthoscopic` | setting | Use orthographic (parallel) projection instead of the perspective transform. | implemented | [doc](features/topics/viewing-camera.md#orthoscopic) |
| `ray_interior_color` | setting | Colour of surface interiors (cut faces) in ray-traced images; -1 uses the object colour. | planned | [doc](features/topics/viewing-camera.md#ray_interior_color) |
| `ray_interior_mode` | setting | How interior faces are generated by the ray tracer. | planned | [doc](features/topics/viewing-camera.md#ray_interior_color) |
| `reflect` | setting | Aggregate intensity of the movable (directional) light sources. | implemented | [doc](features/topics/viewing-camera.md#reflect) |
| `shininess` | setting | Specular exponent for the movable light sources; higher = tighter highlights. | implemented | [doc](features/topics/viewing-camera.md#shininess) |
| `spec_count` | setting | How many movable lights contribute specular reflections; -1 derives from light_count. | planned | [doc](features/topics/viewing-camera.md#spec_count) |
| `spec_power` | setting | Specularity power coefficient for the ray tracer; <0 falls back to shininess. | planned | [doc](features/topics/viewing-camera.md#spec_power) |
| `spec_reflect` | setting | Specular intensity for the ray tracer; <0 falls back to specular_intensity. | planned | [doc](features/topics/viewing-camera.md#spec_reflect) |
| `specular` | setting | Specular (highlight) intensity for the movable light sources. | implemented | [doc](features/topics/viewing-camera.md#specular) |
| `specular_intensity` | setting | Effective specular highlight strength when specular is 1.0. | implemented | [doc](features/topics/viewing-camera.md#specular_intensity) |
| `two_sided_lighting` | setting | Light both faces of a triangle or only the front face; -1 is automatic. | partial | [doc](features/topics/viewing-camera.md#two_sided_lighting) |

## wizard (35)

| Feature | Kind | Summary | Parity | Doc |
| --- | --- | --- | --- | --- |
| `dirty_wizard` `dirty_wizard()` | command | Flag the wizard so the next render pass performs a deferred, feedback-safe refresh. | implemented | [doc](features/topics/wizards.md#dirty_wizard) |
| `get_wizard` `get_wizard()` | command | Return the active (topmost) wizard instance, or None if no wizard is active. | implemented | [doc](features/commands/get_wizard.md) |
| `get_wizard_stack` `get_wizard_stack()` | command | Returns the internal stack of active wizard objects. | internal | [doc](features/commands/get_wizard_stack.md) |
| `refresh_wizard` `refresh_wizard()` | command | Internal, unsupported command that redraws the active wizard's GUI prompt/menu. | internal | [doc](features/commands/refresh_wizard.md) |
| `replace_wizard` `replace_wizard(name=None, *arg, **kwd)` | command | Unsupported internal helper that launches (or clears) a wizard, replacing the current one. | internal | [doc](features/commands/replace_wizard.md) |
| `set_wizard` `set_wizard(wizard=None, replace=0)` | command | Internal command that installs a wizard instance as the active wizard, optionally replacing the current one. | internal | [doc](features/commands/set_wizard.md) |
| `set_wizard_stack` `set_wizard_stack(stack=[])` | command | Internal command that replaces the entire wizard stack with a supplied list. | internal | [doc](features/commands/set_wizard_stack.md) |
| `wizard` `wizard(name=None, *arg, **kwd)` | command | Launch a built-in wizard by name, pushing it onto the wizard stack. | implemented | [doc](features/topics/wizards.md#wizard) |
| `Wizard (base class / protocol)` `Wizard(_self=cmd)` | feature | Base class defining the five render methods (get_prompt/get_panel/get_event_mask/get_menu/cleanup) and eleven do_* event callbacks that every wizard renders through. | implemented | [doc](features/topics/wizards.md#the-protocol-base-class) |
| `wizards` | feature | PyMOL's modal wizard surface: a stack of plain Python objects that expose declarative panel/prompt/menu descriptions and receive pick/select/key events from the C++ core. | implemented | [doc](features/topics/wizards.md#wizards) |
| `annotation` `wizard annotation` | wizard | Show per-state SD-file annotations as a prompt overlay; no picking, refreshes on scene/state/frame. | implemented | [doc](features/topics/wizards.md#annotation) |
| `appearance` `wizard appearance` | wizard | Click-to-restyle three-dropdown verb/target/scope machine (color, toggle, show, hide). | implemented | [doc](features/topics/wizards.md#appearance) |
| `benchmark` `wizard benchmark` | wizard | Measure local GL blit and raytrace throughput across representation types. | partial | [doc](features/topics/wizards.md#benchmark) |
| `box` `wizard box` | wizard | Draw an editable CGO box/plane/wall/quad from four draggable pseudo-atoms. | implemented | [doc](features/topics/wizards.md#box) |
| `charge` `wizard charge` | wizard | Inspect, move, or zero partial_charge on atoms and residues. | implemented | [doc](features/topics/wizards.md#charge) |
| `cleanup` `wizard cleanup` | wizard | Run OpenEye szybki on a ligand and pull minimized coordinates back in. | partial | [doc](features/topics/wizards.md#cleanup) |
| `command` `wizard command` | wizard | Generic wizard that introspects any PyMOL command and renders one pop-up row per keyword argument. | implemented | [doc](features/topics/wizards.md#command) |
| `demo` `wizard demo, <name>` | wizard | Built-in feature tour: a menu of self-running demonstrations. | implemented | [doc](features/topics/wizards.md#demo) |
| `density` `wizard density` | wizard | Roving isomesh around a picked atom/residue, up to three maps at once. | implemented | [doc](features/topics/wizards.md#density) |
| `distance` `wizard distance` | wizard | Legacy distance/angle measurement wizard, superseded by and rewritten to measurement. | internal | [doc](features/topics/wizards.md#distance) |
| `dragging` `wizard dragging` | wizard | The panel shown while the mouse is in the drag editor scheme; self-dismisses when the scheme changes. | implemented | [doc](features/topics/wizards.md#dragging) |
| `filter` `wizard filter` | wizard | Triage a multi-state (docked-compound) object into Accept/Reject/Defer buckets. | implemented | [doc](features/topics/wizards.md#filter) |
| `label` `wizard label` | wizard | Click an atom to toggle a formatted label on it. | implemented | [doc](features/topics/wizards.md#label) |
| `measurement` `wizard measurement` | wizard | Interactive distance/angle/dihedral/H-bond/neighbor measurements; replaces the legacy distance wizard. | implemented | [doc](features/topics/wizards.md#measurement) |
| `message` `wizard message, <text>, dismiss=<0|1>` | wizard | Generic modal notice overlay; used by the cmd.wizard error path. | implemented | [doc](features/topics/wizards.md#message) |
| `mutagenesis` `wizard mutagenesis` | wizard | Swap a protein residue for a rotamer-library entry with bump (strain) scoring and a live preview. | implemented | [doc](features/topics/wizards.md#mutagenesis) |
| `nucmutagenesis` `wizard nucmutagenesis` | wizard | Nucleic-acid mutagenesis: mutate a base (A/C/G/T/U) transferring the chi dihedral. | implemented | [doc](features/topics/wizards.md#nucmutagenesis) |
| `openvr` `wizard openvr` | wizard | In-headset VR menu launched automatically when stereo mode switches to OpenVR. | partial | [doc](features/topics/wizards.md#openvr) |
| `pair_fit` `wizard pair_fit` | wizard | Superpose two objects by user-picked atom pairs. | implemented | [doc](features/topics/wizards.md#pair_fit) |
| `pseudoatom` `wizard pseudoatom, label, pos=[x,y,z]` | wizard | Inline text-entry wizard that creates a labeled pseudoatom at a 3D position. | implemented | [doc](features/topics/wizards.md#pseudoatom) |
| `renaming` `wizard renaming` | wizard | Inline rename of an object/selection/group/scene, launched from context menus. | implemented | [doc](features/topics/wizards.md#renaming) |
| `sculpting` `wizard sculpting` | wizard | Pick a center atom, auto-partition into free/fixed/excluded shells, and enable real-time sculpting. | implemented | [doc](features/topics/wizards.md#sculpting) |
| `security` `wizard security` | wizard | Consent gate shown when a session file contains movie/python commands (accept/decline/mdump). | implemented | [doc](features/topics/wizards.md#security) |
| `stereodemo` `wizard stereodemo, <name>[, mono]` | wizard | Kiosk-style sectioned demo suite for stereo hardware. | implemented | [doc](features/topics/wizards.md#stereodemo) |
| `toggle` `wizard toggle` | wizard | Kiosk-style fullscreen/stereo toggles with an optional message overlay. | implemented | [doc](features/topics/wizards.md#toggle) |

