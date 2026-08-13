---
name: named-colors
kind: feature
category: coloring
summary: PyMOL's 178 built-in named colors — standard palette, bright/light/deep/pale variants, greys, and the periodic-table element colors that drive by-element coloring.
---

# Named Colors

PyMOL ships with 178 built-in **named colors**. A color name is not itself a value — it
resolves to a **color index** in PyMOL's internal color table (registered in the engine via
`reg_named_color` in `layer1/Color.cpp`). Any command that takes a color (`color`, `set_color`,
`bg_color`, CGO color, ramps, etc.) accepts one of these names, and the name is looked up to the
same index every time.

A large majority of the built-in names are **periodic-table element colors** (`hydrogen`,
`carbon`, `oxygen`, `iron`, `gold`, …). These are what by-element coloring uses: `color <elem>`
paints atoms of that element, and the `util.cba*` helpers (e.g. `util.cbaw` — color-by-atom with
**w**hite carbons) recolor a selection element-by-element while overriding only the carbon color.

The remaining names fall into a standard/primary palette, a set of decorative
**bright/light/deep/pale** variants, and two grey aliases (`grey` == `gray`).

To define your own color, register a new name with **`set_color`**:

```python
set_color("myteal", [0.1, 0.6, 0.6])
color myteal, chain A
```

RGB values below are the 0-1 float triples registered in the engine (`packages/engine/layer1/Color.cpp`).

## Standard / primary colors

### Standard & primary

| Color | RGB (0-1) | Notes |
|---|---|---|
| `black` | 0, 0, 0 | Built-in named color |
| `blue` | 0, 0, 1 | Built-in named color |
| `brown` | 0.65, 0.32, 0.17 | Built-in named color |
| `chartreuse` | 0.5, 1, 0 | Built-in named color |
| `chocolate` | 0.555, 0.222, 0.111 | Built-in named color |
| `cyan` | 0, 1, 1 | Built-in named color |
| `dash` | 1, 1, 0 | Built-in named color |
| `density` | 0.1, 0.1, 0.6 | Built-in named color |
| `firebrick` | 0.698, 0.13, 0.13 | Built-in named color |
| `forest` | 0.2, 0.6, 0.2 | Built-in named color |
| `green` | 0, 1, 0 | Built-in named color |
| `lime` | 0.5, 1, 0.5 | Built-in named color |
| `magenta` | 1, 0, 1 | Built-in named color |
| `marine` | 0, 0.5, 1 | Built-in named color |
| `olive` | 0.77, 0.7, 0 | Built-in named color |
| `orange` | 1, 0.5, 0 | Built-in named color |
| `pink` | 1, 0.65, 0.85 | Built-in named color |
| `purple` | 0.75, 0, 0.75 | Built-in named color |
| `red` | 1, 0, 0 | Built-in named color |
| `ruby` | 0.6, 0.2, 0.2 | Built-in named color |
| `salmon` | 1, 0.6, 0.6 | Built-in named color |
| `sand` | 0.72, 0.55, 0.3 | Built-in named color |
| `slate` | 0.5, 0.5, 1 | Built-in named color |
| `teal` | 0, 0.75, 0.75 | Built-in named color |
| `tv_blue` | 0.3, 0.3, 1 | Built-in named color |
| `tv_green` | 0.2, 1, 0.2 | Built-in named color |
| `tv_orange` | 1, 0.55, 0.15 | Built-in named color |
| `tv_red` | 1, 0.2, 0.2 | Built-in named color |
| `tv_yellow` | 1, 1, 0.2 | Built-in named color |
| `violet` | 1, 0.5, 1 | Built-in named color |
| `wheat` | 0.99, 0.82, 0.65 | Built-in named color |
| `white` | 1, 1, 1 | Built-in named color |
| `yellow` | 1, 1, 0 | Built-in named color |


## Bright / light / deep / pale variants

Decorative and tinted variants of the primary hues (the `bright*`, `light*`, `deep*`, `pale*`
families plus related blended names such as `hotpink`, `aquamarine`, and `skyblue`).

### Variants

| Color | RGB (0-1) | Notes |
|---|---|---|
| `_deepsalmon` | 1, 0.42, 0.42 | Built-in named color |
| `aquamarine` | 0.5, 1, 1 | Built-in named color |
| `bluewhite` | 0.85, 0.85, 1 | Built-in named color |
| `brightorange` | 1, 0.7, 0.2 | Built-in named color |
| `darksalmon` | 0.73, 0.55, 0.52 | Built-in named color |
| `deepblue` | 0.25, 0.25, 0.65 | Built-in named color |
| `deepolive` | 0.6, 0.6, 0.1 | Built-in named color |
| `deeppurple` | 0.6, 0.1, 0.6 | Built-in named color |
| `deepsalmon` | 1, 0.5, 0.5 | Built-in named color |
| `deepteal` | 0.1, 0.6, 0.6 | Built-in named color |
| `dirtyviolet` | 0.7, 0.5, 0.5 | Built-in named color |
| `greencyan` | 0.25, 1, 0.75 | Built-in named color |
| `hotpink` | 1, 0, 0.5 | Built-in named color |
| `lightblue` | 0.75, 0.75, 1 | Built-in named color |
| `lightmagenta` | 1, 0.2, 0.8 | Built-in named color |
| `lightorange` | 1, 0.8, 0.5 | Built-in named color |
| `lightpink` | 1, 0.75, 0.87 | Built-in named color |
| `lightteal` | 0.4, 0.7, 0.7 | Built-in named color |
| `limegreen` | 0, 1, 0.5 | Built-in named color |
| `limon` | 0.75, 1, 0.25 | Built-in named color |
| `palecyan` | 0.8, 1, 1 | Built-in named color |
| `palegreen` | 0.65, 0.9, 0.65 | Built-in named color |
| `paleyellow` | 1, 1, 0.5 | Built-in named color |
| `purpleblue` | 0.5, 0, 1 | Built-in named color |
| `raspberry` | 0.7, 0.3, 0.4 | Built-in named color |
| `skyblue` | 0.2, 0.5, 0.8 | Built-in named color |
| `smudge` | 0.55, 0.7, 0.4 | Built-in named color |
| `splitpea` | 0.52, 0.75, 0 | Built-in named color |
| `violetpurple` | 0.55, 0.25, 0.6 | Built-in named color |
| `warmpink` | 0.85, 0.2, 0.5 | Built-in named color |
| `yelloworange` | 1, 0.87, 0.37 | Built-in named color |


## Greys

### Greys

| Color | RGB (0-1) | Notes |
|---|---|---|
| `gray` | 0.5, 0.5, 0.5 | Built-in named color (grey and gray are aliases) |
| `grey` | 0.5, 0.5, 0.5 | Built-in named color (grey and gray are aliases) |


## Element colors

These are the periodic-table (and particle) element colors. `color <name>` colors atoms of that
element, and `util.cbaw` / `util.cbag` / etc. use them for by-element coloring.

### Element colors

| Color | RGB (0-1) | Notes |
|---|---|---|
| `actinium` | 0.439215686, 0.670588235, 0.980392157 | Element color for Actinium |
| `aluminum` | 0.749019608, 0.650980392, 0.650980392 | Element color for Aluminum |
| `americium` | 0.329411765, 0.360784314, 0.949019608 | Element color for Americium |
| `antimony` | 0.619607843, 0.388235294, 0.709803922 | Element color for Antimony |
| `argon` | 0.501960784, 0.819607843, 0.890196078 | Element color for Argon |
| `arsenic` | 0.741176471, 0.501960784, 0.890196078 | Element color for Arsenic |
| `astatine` | 0.458823529, 0.309803922, 0.270588235 | Element color for Astatine |
| `barium` | 0, 0.788235294, 0 | Element color for Barium |
| `berkelium` | 0.541176471, 0.309803922, 0.890196078 | Element color for Berkelium |
| `beryllium` | 0.760784314, 1, 0 | Element color for Beryllium |
| `bismuth` | 0.619607843, 0.309803922, 0.709803922 | Element color for Bismuth |
| `bohrium` | 0.878431373, 0, 0.219607843 | Element color for Bohrium |
| `boron` | 1, 0.709803922, 0.709803922 | Element color for Boron |
| `bromine` | 0.650980392, 0.160784314, 0.160784314 | Element color for Bromine |
| `cadmium` | 1, 0.850980392, 0.560784314 | Element color for Cadmium |
| `calcium` | 0.239215686, 1, 0 | Element color for Calcium |
| `californium` | 0.631372549, 0.211764706, 0.831372549 | Element color for Californium |
| `carbon` | 0.2, 1, 0.2 | Element color for Carbon |
| `cerium` | 1, 1, 0.780392157 | Element color for Cerium |
| `cesium` | 0.341176471, 0.090196078, 0.560784314 | Element color for Cesium |
| `chlorine` | 0.121568627, 0.941176471, 0.121568627 | Element color for Chlorine |
| `chromium` | 0.541176471, 0.6, 0.780392157 | Element color for Chromium |
| `cobalt` | 0.941176471, 0.564705882, 0.62745098 | Element color for Cobalt |
| `copper` | 0.784313725, 0.501960784, 0.2 | Element color for Copper |
| `curium` | 0.470588235, 0.360784314, 0.890196078 | Element color for Curium |
| `deuterium` | 0.9, 0.9, 0.9 | Element color for Deuterium |
| `dubnium` | 0.819607843, 0, 0.309803922 | Element color for Dubnium |
| `dysprosium` | 0.121568627, 1, 0.780392157 | Element color for Dysprosium |
| `einsteinium` | 0.701960784, 0.121568627, 0.831372549 | Element color for Einsteinium |
| `erbium` | 0, 0.901960784, 0.458823529 | Element color for Erbium |
| `europium` | 0.380392157, 1, 0.780392157 | Element color for Europium |
| `fermium` | 0.701960784, 0.121568627, 0.729411765 | Element color for Fermium |
| `fluorine` | 0.701960784, 1, 1 | Element color for Fluorine |
| `francium` | 0.258823529, 0, 0.4 | Element color for Francium |
| `gadolinium` | 0.270588235, 1, 0.780392157 | Element color for Gadolinium |
| `gallium` | 0.760784314, 0.560784314, 0.560784314 | Element color for Gallium |
| `germanium` | 0.4, 0.560784314, 0.560784314 | Element color for Germanium |
| `gold` | 1, 0.819607843, 0.137254902 | Element color for Gold |
| `hafnium` | 0.301960784, 0.760784314, 1 | Element color for Hafnium |
| `hassium` | 0.901960784, 0, 0.180392157 | Element color for Hassium |
| `helium` | 0.850980392, 1, 1 | Element color for Helium |
| `holmium` | 0, 1, 0.611764706 | Element color for Holmium |
| `hydrogen` | 0.9, 0.9, 0.9 | Element color for Hydrogen |
| `indium` | 0.650980392, 0.458823529, 0.450980392 | Element color for Indium |
| `iodine` | 0.580392157, 0, 0.580392157 | Element color for Iodine |
| `iridium` | 0.090196078, 0.329411765, 0.529411765 | Element color for Iridium |
| `iron` | 0.878431373, 0.4, 0.2 | Element color for Iron |
| `krypton` | 0.360784314, 0.721568627, 0.819607843 | Element color for Krypton |
| `lanthanum` | 0.439215686, 0.831372549, 1 | Element color for Lanthanum |
| `lawrencium` | 0.780392157, 0, 0.4 | Element color for Lawrencium |
| `lead` | 0.341176471, 0.349019608, 0.380392157 | Element color for Lead |
| `lithium` | 0.8, 0.501960784, 1 | Element color for Lithium |
| `lonepair` | 0.5, 0.5, 0.5 | Element color for Lone pair |
| `lutetium` | 0, 0.670588235, 0.141176471 | Element color for Lutetium |
| `magnesium` | 0.541176471, 1, 0 | Element color for Magnesium |
| `manganese` | 0.611764706, 0.478431373, 0.780392157 | Element color for Manganese |
| `meitnerium` | 0.921568627, 0, 0.149019608 | Element color for Meitnerium |
| `mendelevium` | 0.701960784, 0.050980392, 0.650980392 | Element color for Mendelevium |
| `mercury` | 0.721568627, 0.721568627, 0.815686275 | Element color for Mercury |
| `molybdenum` | 0.329411765, 0.709803922, 0.709803922 | Element color for Molybdenum |
| `neodymium` | 0.780392157, 1, 0.780392157 | Element color for Neodymium |
| `neon` | 0.701960784, 0.890196078, 0.960784314 | Element color for Neon |
| `neptunium` | 0, 0.501960784, 1 | Element color for Neptunium |
| `nickel` | 0.31372549, 0.815686275, 0.31372549 | Element color for Nickel |
| `niobium` | 0.450980392, 0.760784314, 0.788235294 | Element color for Niobium |
| `nitrogen` | 0.2, 0.2, 1 | Element color for Nitrogen |
| `nobelium` | 0.741176471, 0.050980392, 0.529411765 | Element color for Nobelium |
| `osmium` | 0.149019608, 0.4, 0.588235294 | Element color for Osmium |
| `oxygen` | 1, 0.3, 0.3 | Element color for Oxygen |
| `palladium` | 0, 0.411764706, 0.521568627 | Element color for Palladium |
| `phosphorus` | 1, 0.501960784, 0 | Element color for Phosphorus |
| `platinum` | 0.815686275, 0.815686275, 0.878431373 | Element color for Platinum |
| `plutonium` | 0, 0.419607843, 1 | Element color for Plutonium |
| `polonium` | 0.670588235, 0.360784314, 0 | Element color for Polonium |
| `potassium` | 0.560784314, 0.250980392, 0.831372549 | Element color for Potassium |
| `praseodymium` | 0.850980392, 1, 0.780392157 | Element color for Praseodymium |
| `promethium` | 0.639215686, 1, 0.780392157 | Element color for Promethium |
| `protactinium` | 0, 0.631372549, 1 | Element color for Protactinium |
| `pseudoatom` | 0.9, 0.9, 0.9 | Element color for Pseudoatom |
| `radium` | 0, 0.490196078, 0 | Element color for Radium |
| `radon` | 0.258823529, 0.509803922, 0.588235294 | Element color for Radon |
| `rhenium` | 0.149019608, 0.490196078, 0.670588235 | Element color for Rhenium |
| `rhodium` | 0.039215686, 0.490196078, 0.549019608 | Element color for Rhodium |
| `rubidium` | 0.439215686, 0.180392157, 0.690196078 | Element color for Rubidium |
| `ruthenium` | 0.141176471, 0.560784314, 0.560784314 | Element color for Ruthenium |
| `rutherfordium` | 0.8, 0, 0.349019608 | Element color for Rutherfordium |
| `samarium` | 0.560784314, 1, 0.780392157 | Element color for Samarium |
| `scandium` | 0.901960784, 0.901960784, 0.901960784 | Element color for Scandium |
| `seaborgium` | 0.850980392, 0, 0.270588235 | Element color for Seaborgium |
| `selenium` | 1, 0.631372549, 0 | Element color for Selenium |
| `silicon` | 0.941176471, 0.784313725, 0.62745098 | Element color for Silicon |
| `silver` | 0.752941176, 0.752941176, 0.752941176 | Element color for Silver |
| `sodium` | 0.670588235, 0.360784314, 0.949019608 | Element color for Sodium |
| `strontium` | 0, 1, 0 | Element color for Strontium |
| `sulfur` | 0.9, 0.775, 0.25 | Element color for Sulfur |
| `tantalum` | 0.301960784, 0.650980392, 1 | Element color for Tantalum |
| `technetium` | 0.231372549, 0.619607843, 0.619607843 | Element color for Technetium |
| `tellurium` | 0.831372549, 0.478431373, 0 | Element color for Tellurium |
| `terbium` | 0.188235294, 1, 0.780392157 | Element color for Terbium |
| `thallium` | 0.650980392, 0.329411765, 0.301960784 | Element color for Thallium |
| `thorium` | 0, 0.729411765, 1 | Element color for Thorium |
| `thulium` | 0, 0.831372549, 0.321568627 | Element color for Thulium |
| `tin` | 0.4, 0.501960784, 0.501960784 | Element color for Tin |
| `titanium` | 0.749019608, 0.760784314, 0.780392157 | Element color for Titanium |
| `tungsten` | 0.129411765, 0.580392157, 0.839215686 | Element color for Tungsten |
| `uranium` | 0, 0.560784314, 1 | Element color for Uranium |
| `vanadium` | 0.650980392, 0.650980392, 0.670588235 | Element color for Vanadium |
| `xenon` | 0.258823529, 0.619607843, 0.690196078 | Element color for Xenon |
| `ytterbium` | 0, 0.749019608, 0.219607843 | Element color for Ytterbium |
| `yttrium` | 0.580392157, 1, 1 | Element color for Yttrium |
| `zinc` | 0.490196078, 0.501960784, 0.690196078 | Element color for Zinc |
| `zirconium` | 0.580392157, 0.878431373, 0.878431373 | Element color for Zirconium |

