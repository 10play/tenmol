---
title: "Settings reference — batch 00 (settings 1–200)"
kind: settings-batch
category: settings
summary: "Reference for PyMOL settings 1–200 (file order in settings.mdx), grouped by prefix family, with defaults and what each controls."
parity: mixed
---

# PyMOL Settings — Batch 00 (names 1–200)

Covers the first 200 of the 779 PyMOL setting names (file order in
`docs/api-reference/settings.mdx`), grouped by prefix family. Defaults are taken from
`packages/engine/layer1/SettingInfo.h`; descriptions from
`packages/engine/data/setting_help.csv` and `docs/settings-colors.md`. Use with
`set <name>, <value>[, <selection>]` and `get <name>`.

## Selections (active_selections)

| Setting | Default | Controls |
| --- | --- | --- |
| `active_selections` | `on` | controls whether or not PyMOL relies upon the concept of an active selection. |

## Alignment (alignment_as_cylinders)

| Setting | Default | Controls |
| --- | --- | --- |
| `alignment_as_cylinders` | `off` | If true, distance measure dashes are drawn as high-quality cylinders instead of lines. |

## Object states (all_states)

| Setting | Default | Controls |
| --- | --- | --- |
| `all_states` | `off` | controls whether or not all molecular states are visible. |

## Lighting (ambient_*, direct)

| Setting | Default | Controls |
| --- | --- | --- |
| `ambient` | `0.14` | (float 0.0-1.0, default: 0.14) controls the ambient lighting level. |
| `ambient_occlusion_mode` | `0` | Controls which method is used to draw ambient occlusion. 0=disabled, 1=atom-based occlusion, 2=triangle-based occlusion |
| `ambient_occlusion_scale` | `25.0` | The scale by which ambient occlusion values are modified. The larger this value the more hinting is applied. |
| `ambient_occlusion_smooth` | `10` | Controls whether or not ambient occlusion uses smoothing of nearby values. |
| `direct` | `0.45` | (float 0.0-1.0, default: 0.45) is the amount of light being emitted from the camera. |

## Stereo & Depth (anaglyph_mode, chromadepth, depth_cue)

| Setting | Default | Controls |
| --- | --- | --- |
| `anaglyph_mode` | `4` | implements the following 4 anaglyph modes (see also Anaglyph stereo mode settings) 0 = true anaglyph 1 = gray 2 = color 3 = half-color 4 = optimized (default) |
| `chromadepth` | `0` | Enables ChromaDepth stereo encoding (color-coded depth) when non-zero. |
| `depth_cue` | `on` | controls whether or not a depth cue fog effect is used. |

## Measurement labels (angle_*, dihedral_*, dist/distance, dynamic_measures)

| Setting | Default | Controls |
| --- | --- | --- |
| `angle_color` | `default` | Controls the coloring of angle measures. |
| `angle_label_position` | `0.5` | (float: >0.0, default: 0.5) controls where the angle label is drawn. |
| `angle_size` | `0.6666` | (float: >0.0, default: 0.6666) controls how far out the angle indicator is drawn. |
| `dihedral_color` | `default` | controls dihedral measurement colors. |
| `dihedral_label_position` | `1.2` | (float: >0.0, default: 1.2) controls where the dihedral label is drawn. |
| `dihedral_size` | `0.6666` | (float: >0.0, default: 0.6666) controls how far out the dihedral indicator is drawn. |
| `dist_counter` | `0` | is the counter used when auto-generating measurement object names. |
| `distance_exclusion` | `5` | controls the cutoff of bonds that two atoms must exceed if a distance is to be drawn between them when mode=3 is used as an option to the distance command. |
| `dynamic_measures` | `1` | controls whether or not PyMOL updates measurement objects when incorporated atoms are moved. |

## Animation (animation_*)

| Setting | Default | Controls |
| --- | --- | --- |
| `animation` | `on` | controls whether or not the camera is smoothly interpolated between views. |
| `animation_duration` | `0.75` | controls the default duration of animation for changes in view (note: scene_animation_duration controls the timing of scene transitions. |

## Rendering & antialiasing (antialias_*, backface_cull, draw_*, ati_bugs)

| Setting | Default | Controls |
| --- | --- | --- |
| `antialias` | `1` | (integer 0-4, default: 1) general settings for controlling antialiasing. 0 = no antialiasing 1 = adaptive antialiasing 2 = 2-times uniform oversampling plus adaptive antialiasing 3 = 3-times uniform oversampling plus adaptive antialiasing 4 = 4-times uniform oversampling plus adaptive antialiasing |
| `antialias_shader` | `0` | Real-time (shader) antialiasing: 0 none, 1 FXAA, 2 SMAA. |
| `ati_bugs` | `false` | Controls whether or not PyMOL adapts its rendering to avoid known ATI bugs. |
| `backface_cull` | `off` | controls whether or not the raytracer renders backfacing triangles. |
| `draw_frames` | `off` | controls whether or not each movie frame is rendered using the \draw\" command." |
| `draw_mode` | `0` | 0 is the normal OpenGL renderer; 1 is antialised OpenGL; 2 is ray traced without shadows; 3 is ray traced with shadows. |

## File I/O — mmCIF (assembly, cif_*, chem_comp_cartn_use)

| Setting | Default | Controls |
| --- | --- | --- |
| `assembly` | `''` | For loading mmCIF files: Read assembly (biological unit) instead of asymmetric unit |
| `chem_comp_cartn_use` | `0` | For mmCIF chem_comp: which Cartesian coordinate columns to use. |
| `cif_keepinmemory` | `off` | Experimental feature. Retain parsed CIF file in memory, for pymol.querying.cif_get_array |
| `cif_metalc_as_zero_order_bonds` | `off` | If on, metal-coordination records in mmCIF are imported as zero-order bonds. |
| `cif_use_auth` | `on` | When loading mmCIF files, use 'auth_*' identifiers (if present, fallback to 'label_*' identifiers). Note that 'label_asym_id' is always loaded as the 'segi' identifier (if present). |

## Performance, deferred builds & cache (async_builds, defer_*, cache_*)

| Setting | Default | Controls |
| --- | --- | --- |
| `async_builds` | `off` | controls whether or not geometry builds should be performed in parallel on multithreaded machines. WARNING: This setting can create instability and should be used with caution. |
| `auto_defer_builds` | `500` | Multistate models with fewer than ''auto_defer_builds'' number of states will automatically be preprocessed for geometry and rendering. Set to -1 to process all states regardless of count. |
| `cache_display` | `on` | controls whether or not a copy is made of the current display in order to speed updates of menus, etc. |
| `cache_frames` | `off` | controls whether or not each movie frame will be stored in RAM and then replayed from memory. This is used for previewing a movie at a higher frame rate. The \mclear\" command can be used to flush this cache." |
| `cache_max` | `25000000` | controls how many primitive data elements can be retained in the geometry cache (before old/unused entries are expired). |
| `cache_memory` | `off` | special case, currently unsupported setting. |
| `cache_mode` | `0` | (integer: 0-2, default 0) controls whether or not PyMOL retains precomputed geometries (such as molecular surfaces) inside the session file. 0: off 1: read only 2: retain all new surfaces computed |
| `defer_builds_mode` | `0` | controls when the underlying geometry for molecular representations is generated, as follows: 0: visible geometry for all states of all enabled objects is generated upfront and retained in memory for reuse (highest memory usage). 1: visible geometry for the current states of all enabled objects is generated only when needed and then retained in memory for later reuse. 2: visible geometry for the current state of all enabled objects is generated only when needed and retained for the current state, even in disabled objects. 3: visible geometry for the current state of all enabled objects is generated only when needs and retained for reuse in enabled objects only while in the current state (lowest memory usage). |
| `defer_updates` | `off` | If on, scene/geometry updates are deferred (batched) rather than applied immediately. |

## Atom naming & typing (atom_*)

| Setting | Default | Controls |
| --- | --- | --- |
| `atom_name_wildcard` | `''` | controls the wildcard character used when matching atom names. If this string is empty, then the normal wildcard setting will be used. The practical purpose of this setting is to disable use of asterisks as an atom name wildcard when PDB structures are loaded with asterisks in atom names. |
| `atom_type_format` | `mol2` | Sets the label format for label types. Supported options are: mol2, sybyl, macromodel, mmd, sdf. mol2 sybyl (synonym for mol2) macromodel mmd (synonym for macromodel) sdf (default) |

## Automatic behaviours (auto_*, autoclose_dialogs)

| Setting | Default | Controls |
| --- | --- | --- |
| `auto_classify_atoms` | `on` | controls whether or not PyMOL spends extra CPU cycles classifying atoms as polymer, organic, solvent, or inorganic as well as locating per-residue guide atoms. |
| `auto_color` | `on` | controls whether or not new objects are given a different color for their carbon atoms. |
| `auto_color_next` | `0` | Index of the next auto color to be assigned by auto_color. |
| `auto_copy_images` | `off` | controls whether or not PyMOL automatically copies images from the OpenGL viewport into the system's clipboard. |
| `auto_defer_atom_count` | `0` | Structures with fewer than ''auto_defer_atom_count'' atoms are automatically labeled upon loading. Set to 0 to auto label none. |
| `auto_dss` | `on` | controls whether or not secondary structure is automatically computed for structure which lack such definitions. |
| `auto_hide_selections` | `on` | controls whether or not PyMOL automatically disables selections when new objects or selections are created. |
| `auto_indicate_flags` | `off` | controls whether or not PyMOL automatically indicates flagged atoms when the \flag\" command is issue." |
| `auto_number_selections` | `off` | controls whether PyMOL gives each new unnamed selection a unique name or whether it simply uses \sele\"." |
| `auto_overlay` | `off` | controls whether or not overlay text is automatically shown/hidden in response to user actions. |
| `auto_remove_hydrogens` | `off` | controls whether or not hydrogens are automatically removed when building. |
| `auto_rename_duplicate_objects` | `off` | if on, PyMOL will rename new objects that have the same name as an existing object; if off, PyMOL will overwrite the existing object. |
| `auto_sculpt` | `off` | controls whether or not sculpting is automatically activated when an atom is moved. |
| `auto_show_classified` | `-1` | How newly classified atoms are shown: -1 auto, 0 off, 1 as, 2 show, 3 simple. |
| `auto_show_lines` | `on` | controls whether or not the lines representation is automatically shown for new objects. |
| `auto_show_nonbonded` | `on` | control whether or not the nonbonded representation is automatically shown for new objects. |
| `auto_show_selections` | `on` | controls whether or not PyMOL automatically enables each new selection. |
| `auto_show_spheres` | `off` | controls whether or not the sphere representation is automatically shown for new objects. |
| `auto_zoom` | `-1` | controls automatic zooming behavior: 0 = no zoom 1 = zoom new objects 2 = zoom always 3 = zoom current state always 4 = zoom all objects 5 = zoom first object only |
| `autoclose_dialogs` | `on` | Unused setting. |

## System & GUI (batch_prefix, debug_pick, colored_feedback, display_scale_factor)

| Setting | Default | Controls |
| --- | --- | --- |
| `batch_prefix` | `tmp_pymol` | contains a prefix to be used for temporary files. |
| `colored_feedback` | `off` | If on, console/feedback text is colorized. |
| `debug_pick` | `0` | a setting for debugging mouse pick problems. |
| `display_scale_factor` | `1` | Integer UI/display scaling factor for high-DPI (HiDPI/Retina) screens. |

## Background (bg_*)

| Setting | Default | Controls |
| --- | --- | --- |
| `bg_gradient` | `off` | Controls whether or not the background is gradient colored. If yes, then bg_rgb_top and bg_rgb_bottom will be used to set the colors. |
| `bg_image_filename` | `''` | if set controls the image used in the background. |
| `bg_image_linear` | `on` | controls the sampling of the texture for the background image. If off, then the nearest pixel is set, otherwise, a linear interpolation is used. |
| `bg_image_mode` | `0` | Determines how the background image is drawn. 0 - stretched, 1 - centered, 2 - tiled, 3 - centered and repeated |
| `bg_image_tilesize` | `[100.0, 100.0, 0.0]` | This setting is used when bg_image_mode=3 and defines the size of each tile (in x and y, z is not used). |
| `bg_rgb` | `[0.0,0.0,0.0]` | controls the background rgb color. |
| `bg_rgb_bottom` | `[0.2,0.2,0.5]` | Controls bottom color when bg_gradient is set. |
| `bg_rgb_top` | `[0.0,0.0,0.3]` | Controls top color when bg_grdient is set. |

## Mouse / button mode (button_mode*)

| Setting | Default | Controls |
| --- | --- | --- |
| `button_mode` | `0` | reports the current button mode index (internal). |
| `button_mode_name` | `3-Button Viewing` | reports the current button mode name. |

## Cartoon representation (cartoon_*)

| Setting | Default | Controls |
| --- | --- | --- |
| `cartoon_all_alt` | `off` | If on, cartoon is drawn through all alternate-location atoms rather than just the primary altloc. |
| `cartoon_color` | `-1` | (color, default:-1) controls the color of the cartoon representation. |
| `cartoon_cylindrical_helices` | `off` | controls whether helices are displayed as cylinders or as a residue-based cartoon. |
| `cartoon_debug` | `0` | (integer: 0-3, default: 0) is for development. |
| `cartoon_discrete_colors` | `off` | affects whether per-residue colors change at or halfway inbetween the C-alpha position. |
| `cartoon_dumbbell_length` | `1.6` | is a parameter for the dumbbell cross-section. |
| `cartoon_dumbbell_radius` | `0.16` | is a parameter for the dumbbell cross-section. |
| `cartoon_dumbbell_width` | `0.17` | is a parameter for the dumbbell cross-section. |
| `cartoon_fancy_helices` | `off` | controls whether dumbbell or oval cross-section is used. |
| `cartoon_fancy_sheets` | `on` | controls whether or not beta-sheet strands have arrows. |
| `cartoon_flat_cycles` | `4` | is the number of cycles of \flattening\" applied to beta-sheets when cartoon_flat_sheets is on." |
| `cartoon_flat_sheets` | `on` | controls whether or not beta-sheet strands are flattened. |
| `cartoon_gap_cutoff` | `10` | cutoff for drawing a dashed cartoon loop across gaps. E.g. if one residue is missing, the cutoff needs to be >=2 (or for 5 missing residues, >= 6, etc.). |
| `cartoon_helix_radius` | `2.25` | controls the radius of the cylindrical helix representation. |
| `cartoon_highlight_color` | `-1` | controls the accent color. |
| `cartoon_ladder_color` | `-1` | controls the color of the ladder representation. |
| `cartoon_ladder_mode` | `1` | controls how the ladder is drawn. |
| `cartoon_ladder_radius` | `0.25` | controls the radius of the ladder representation. |
| `cartoon_loop_cap` | `1` | (integer: 0-2, default: 1) controls how loop segments are capped: 0 = not capped 1 = round cap 2 = flat cap |
| `cartoon_loop_quality` | `-1` | controls how many facets are used to draw the loop cross-section. |
| `cartoon_loop_radius` | `0.2` | controls the radius of loop segments. |
| `cartoon_nucleic_acid_as_cylinders` | `on` | controls whether or not PyMOL draws cartoon nucleic acids as high-quality cylinders or low-quality. |
| `cartoon_nucleic_acid_color` | `-1` | controls the control of nucleic acid backbone cartoons. |
| `cartoon_nucleic_acid_mode` | `4` | controls how the nucleic acid backbone is computed: 0 = use P coordinates 1 = use C1* coordinates 2 = use P coordinates and terminal 3' OH (if present) 3 = use P coordinates and terminal 5' OH (if present) 4 = use P coordinates and both terminal 3' and 5' OHs (if present) |
| `cartoon_oval_length` | `1.35` | is the length of the oval cross-section. |
| `cartoon_oval_quality` | `-1` | controls how many facets are used to draw the oval cross-section. |
| `cartoon_oval_width` | `0.25` | is the width of the oval cross section. |
| `cartoon_power` | `2.0` | affects cartoon shape. |
| `cartoon_power_b` | `0.52` | affects cartoon shape. |
| `cartoon_putty_quality` | `-1` | controls how many facets are used. |
| `cartoon_putty_radius` | `0.4` | is the default putty size. |
| `cartoon_putty_range` | `2.0` | is a putty scaling parameter. |
| `cartoon_putty_scale_max` | `4.0` | is a putty scaling parameter. |
| `cartoon_putty_scale_min` | `0.6` | is a putty scaling parameter. |
| `cartoon_putty_scale_power` | `1.5` | is a putty scaling parameter. |
| `cartoon_putty_transform` | `0` | 0 is normalized nonlinear scaling; 1 is relative nonlinear scaling; 2 is scaled nonlinear scaling; 3 is absolute nonlinear scaling; 4 is normalized linear scaling; 5 is relative linear scaling; 6 is scaled linear scaling; 7 is absolute linear scaling from the B factor; and, 8 is implied RMS scaling. |
| `cartoon_rect_length` | `1.4` | is the length of the rectangle cross-section. |
| `cartoon_rect_width` | `0.4` | is the width of the rectangle cross-section. |
| `cartoon_refine` | `5` | controls how much refinement is done of intermediate cartoon coordinates. |
| `cartoon_refine_normals` | `-1` | controls whether or not normals are refined (-1 = automatic). |
| `cartoon_refine_tips` | `10` | controls how much the tips of beta-strands are refined (straightened). |
| `cartoon_ring_color` | `-1` | controls the color of ring representation. |
| `cartoon_ring_finder` | `1` | Which rings the cartoon ring finder detects: 1 bases+sugars, 2 bases only, 3 non-protein rings, 4 all rings. |
| `cartoon_ring_mode` | `0` | controls how rings are shown: 0 = no ring (use ladders for bases, if applicable) 1 = round-edge rings 2 = square-edge rings 3 = rings with edges 4 = show ring as a sphere of approximate size 5 = show ring centers as small spheres |
| `cartoon_ring_radius` | `-1` | controls the radius of the sphere used to represent rings (-1.0 means compute from ring geometry). |
| `cartoon_ring_transparency` | `-1.0` | controls the transparency level of rings. When negative, this setting is controlled by cartoon_transparency. |
| `cartoon_ring_width` | `0.125` | controls the thickness of the ring representation. |
| `cartoon_round_helices` | `on` | controls whether or not PyMOL makes helices round by forcing orientation vectors to point along the helix axes. |
| `cartoon_sampling` | `-1` | controls how many facets are used to draw cartoon segments. |
| `cartoon_side_chain_helper` | `off` | controls whether or not PyMOL will hide backbone lines and sticks when the cartoon representation is visible as well as disabling smoothing for C-alpha coordinates for residues whose side chains are shown. |
| `cartoon_smooth_cycles` | `2` | controls how many smoothing cycles are applied to the overall cartoon. |
| `cartoon_smooth_cylinder_cycles` | `3` | Number of smoothing passes applied to cylindrical (helix) cartoon axes. |
| `cartoon_smooth_cylinder_window` | `2` | Window size used when smoothing cylindrical (helix) cartoon axes. |
| `cartoon_smooth_first` | `1` | (integer, default: 1) controls the start point for smoothing each segment. |
| `cartoon_smooth_last` | `1` | controls the stop point for smoothing of each segment. |
| `cartoon_smooth_loops` | `off` | controls whether or not loop segments are smoothed. Note that this setting modifies the apparent coordinates of the loop in order to achieve improved aesthetics. |
| `cartoon_throw` | `1.35` | affects cartoon geometry. |
| `cartoon_trace_atoms` | `off` | controls whether cartoons are traced through all atoms. Note that this setting only works well for the loop and tube representations. |
| `cartoon_transparency` | `0.0` | controls the transparency of cartoon representations. |
| `cartoon_tube_cap` | `2` | controls the type of cap applied to the tube, and accepts the same values as cartoon_loop_cap. |
| `cartoon_tube_quality` | `-1` | controls how many facets are used in the tube cross-section. |
| `cartoon_tube_radius` | `0.5` | controls the radius of tube segments. |
| `cartoon_use_shader` | `on` | If true, on screen rendering of cartoons uses the OpenGL shader language (GLSL) to render cartoon. If false, OpenGL v1.x style rendering is used. |

## Surface (cavity_cull, dot_solvent)

| Setting | Default | Controls |
| --- | --- | --- |
| `cavity_cull` | `10` | is the threshold below which isolated clusters of points will be excluded from the surface representation. These are generally interior pockets inside of proteins. |
| `dot_solvent` | `off` | controls whether we generate dots for the atomic or solvent accessible surface. |

## Crystallographic unit cell (cell_*)

| Setting | Default | Controls |
| --- | --- | --- |
| `cell_centered` | `off` | If on, the crystallographic unit-cell box is drawn centered on the origin. |
| `cell_color` | `-1` | Color of the unit-cell box (-1 = default/object color). |

## CGO & procedural geometry (cgo_*, cone_quality)

| Setting | Default | Controls |
| --- | --- | --- |
| `cgo_debug` | `0` | Controls whether or not PyMOL shows debugging graphics related to CGO objects. |
| `cgo_dot_radius` | `-1.0` | if greater than zero, controls the default radius for cgo dots when ray tracing. Otherwise, the radius is computed from cgo_dot_width. |
| `cgo_dot_width` | `2.0` | controls the width of cgo dots. |
| `cgo_ellipsoid_quality` | `-1` | Controls cgo-based representation quality of ellipsoids. |
| `cgo_lighting` | `1` | controls whether or not PyMOL lights CGOs. |
| `cgo_line_radius` | `-0.05` | if greater than zero, controls the default radius for lines when ray tracing. Otherwise, the radius is computed from cgo_line_width; |
| `cgo_line_width` | `1.0` | is the default line width for cgo geometries. |
| `cgo_ray_width_scale` | `-0.15` | Scale applied to CGO line widths when ray tracing (negative = pixel-width fallback). |
| `cgo_shader_ub_color` | `0` | controls the data size of color data sent to the graphics card. If enabled, unsigned bytes are sent which may be faster and smaller. |
| `cgo_shader_ub_flags` | `0` | controls whether or not unsigned bytes are used in sending data to the graphics card. |
| `cgo_shader_ub_normal` | `0` | controls the data size of normals sent to the graphics card. If enabled, unsigned bytes are sent which may be faster and smaller. |
| `cgo_sphere_quality` | `1` | controls the sphere quality to use when loading CGO representations. |
| `cgo_transparency` | `0.0` | controls the default transparency of cgo geometries. |
| `cgo_use_shader` | `on` | If true, on screen rendering of CGOs uses the OpenGL shader language (GLSL). If false, OpenGL v1.x style rendering is used. |
| `cone_quality` | `18` | controls the number of segments used to draw CGO cones. |

## Coloring (clamp_colors)

| Setting | Default | Controls |
| --- | --- | --- |
| `clamp_colors` | `on` | controls whether or not colors are clamped to the current color table. |

## Sculpting / clean (clean_electro_mode)

| Setting | Default | Controls |
| --- | --- | --- |
| `clean_electro_mode` | `1` | Electrostatic model used by the clean/geometry-optimization routine. |

## Export — COLLADA (collada_*)

| Setting | Default | Controls |
| --- | --- | --- |
| `collada_background_box` | `off` | If on, a background box is included in exported COLLADA (.dae) scenes. |
| `collada_export_lighting` | `0` | If non-zero, light sources are written into exported COLLADA scenes. |
| `collada_geometry_mode` | `1` | Geometry granularity/mode used when exporting COLLADA. |

## Bond detection (connect_*)

| Setting | Default | Controls |
| --- | --- | --- |
| `connect_bonded` | `off` | controls whether or not bonds can be detected between atoms with explicit bonds in the PDB file. |
| `connect_cutoff` | `0.35` | affects how close atoms need to be in order for bonds to be created. |
| `connect_mode` | `0` | controls how bonds are detected when PDB files are loaded. 0 = auto-connect and use explicit valences 1 = use explicit valences only 2 = reserved |

## Electrostatics (coulomb_*)

| Setting | Default | Controls |
| --- | --- | --- |
| `coulomb_cutoff` | `10.0` | is the cutoff for coulombic calculations. |
| `coulomb_dielectric` | `2.0` | is the dielectric for coulombic calculations. |
| `coulomb_units_factor` | `557.0` | is the conversion factor to give output units (kT/e). |

## Dashed lines (dash_*)

| Setting | Default | Controls |
| --- | --- | --- |
| `dash_as_cylinders` | `on` | If true, distance measure dashes are drawn as high-quality cylinders instead of lines. |
| `dash_color` | `-1` | Controls the color of dashes used to represent distance measures. |
| `dash_gap` | `0.45` | controls the length of the visible dash. |
| `dash_length` | `0.15` | controls the separation between dashes. |
| `dash_radius` | `0.0` | if greater than zero, controls the radius of the dash when ray tracing. Otherwise, the radius is computed from dash_width. |
| `dash_round_ends` | `on` | controls whether or not dashes are rounded on their ends. |
| `dash_transparency` | `0.0` | Transparency (0-1) of dashed lines such as distance measures. |
| `dash_use_shader` | `on` | If true, on screen rendering of dashes uses the OpenGL shader language (GLSL). If false, OpenGL v1.x style rendering is used. |
| `dash_width` | `2.5` | controls the width of the lines used to draw dashes. |

## Map / mtz auto-load defaults (default_*)

| Setting | Default | Controls |
| --- | --- | --- |
| `default_2fofc_map_rep` | `volume` | This controls the default map representation when a 2FoFc map is loaded from an MTZ map. |
| `default_buster_names` | `2FOFCWT PH2FOFCWT FOFCWT PHFOFCWT` | This is the list of valid column names to be sought when autoloading Buster maps. |
| `default_fofc_map_rep` | `volume` | This controls the default map representation when a FoFc map is loaded from an MTZ map. |
| `default_phenix_names` | `2FOFCWT PH2FOFCWT FOFCWT PHFOFCWT` | This is the list of valid column names to be sought when autoloading Phenix maps. |
| `default_phenix_no_fill_names` | `2FOFCWT_no_fill PH2FOFCWT_no_fill None None` | This is the list of valid column names to be sought when autoloading Phenix (no fill) maps. |
| `default_refmac_names` | `FWT PHWT DELFWT PHDELWT` | This is the list of valid column names to be sought when autoloading Refmac maps. |

## Dot surface (dot_*)

| Setting | Default | Controls |
| --- | --- | --- |
| `dot_as_spheres` | `off` | If on, dot-surface dots are drawn as small shaded spheres instead of flat points. |
| `dot_color` | `-1` | (color, default -1) controls the color of the dot representation. By default, dots assume the color of the associated atom. |
| `dot_density` | `2` | controls the density of dots taken from the surface of a sphere. |
| `dot_hydrogens` | `on` | controls whether or not dots are drawn on hydrogen atoms. |
| `dot_lighting` | `on` | controls whether or not dots are lit based on their associated surface normals. The setting has no effect when ray tracing. |
| `dot_mode` | `0` | Dot-surface generation mode. |
| `dot_normals` | `on` | controls whether or not dots are drawn with normals. This achieves essentially the same effect as dot_lighting, and it too has no effect when ray tracing. |
| `dot_radius` | `0.0` | if greater than zero, controls the radius of dots. Otherwise, the dot radius is computed from dot_width based on the pixel size of the current viewport. |
| `dot_use_shader` | `on` | If true, on screen rendering of dots uses the OpenGL shader language (GLSL). If false, OpenGL v1.x style rendering is used. |
| `dot_width` | `2.0` | controls the dot width in viewport pixels. |

## Dynamic line width (dynamic_*)

| Setting | Default | Controls |
| --- | --- | --- |
| `dynamic_width` | `on` | controls whether or not PyMOL draws lines thicker for easier viewing. |
| `dynamic_width_factor` | `0.06` | controls the dynamic width scaling. |
| `dynamic_width_max` | `2.5` | controls the dynamic width scaling. |
| `dynamic_width_min` | `0.75` | controls the dynamic width scaling. |
