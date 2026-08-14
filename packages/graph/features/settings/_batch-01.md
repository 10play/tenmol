---
title: "Settings Reference — Batch 01 (settings 201–400)"
kind: setting
category: settings
summary: "Grouped reference for PyMOL settings 201–400 (file order), organised by prefix family, with defaults from SettingInfo.h."
parity: mixed
---

# Settings Reference — Batch 01

This batch documents 200 PyMOL settings (numbers 201–400 in `docs/api-reference/settings.mdx`, file order), grouped by prefix family. Defaults, value types and setting *level* (global / object / ostate / astate / atom / bond) are taken verbatim from `packages/engine/layer1/SettingInfo.h`. A handful are consumed by the TypeScript renderer (`packages/engine-ts/src`) and are marked accordingly; most are engine/GUI settings not yet exercised by the TS parity port.

Level legend: **global** = one value per session; **object** = per-object; **ostate**/**astate** = per-object-state / per-atom-state; **atom**/**bond** = per-atom / per-bond.

## editor

**Editor & edit-mode.** Controls PyMOL's interactive builder/editor mode: how the on-screen editing light behaves and what the editor auto-computes (dihedrals, measurements, origin) as you build.

| Setting | Default | Level | Controls |
|---------|---------|-------|----------|
| `edit_light` | `1` | global | Which light source (index) is manipulated while in edit-light mode. |
| `editor_auto_dihedral` | `on (1)` | global | Auto-adjust the dependent dihedral when editing torsions. |
| `editor_auto_measure` | `on (1)` | global | Automatically create a measurement for the atoms being edited. |
| `editor_auto_origin` | `on (1)` | global | Recenter the rotation origin on the current editor selection. |
| `editor_bond_cycle_mode` | `on (1)` | object | >0 includes aromatic when cycling bond order with the builder. |
| `editor_label_fragments` | `off (0)` | global | Label atoms of freshly built/attached fragments. |

## ellipsoid

**ADP / thermal ellipsoids.** Anisotropic displacement parameter (ADP / thermal) ellipsoids drawn from atomic U-values; these settings govern their size, probability level, tessellation quality, colour and transparency.

| Setting | Default | Level | Controls |
|---------|---------|-------|----------|
| `ellipsoid_color` | `-1` | atom | Colour of ADP ellipsoids (-1 = use atom colour). |
| `ellipsoid_probability` | `0.5` | ostate | Probability level (0–1) defining the ellipsoid surface (0.5 ≈ 50%). |
| `ellipsoid_quality` | `1` | global | Tessellation subdivision level of the ellipsoid mesh. |
| `ellipsoid_scale` | `1.0` | atom | Uniform scale factor applied to ellipsoid radii. |
| `ellipsoid_transparency` | `0.0` | atom | Transparency (0=opaque, 1=invisible) of ellipsoids. |

## performance

**Idle, threading & performance.** Idle timers, keep-alive, spatial-hash capacity, threading, frame-rate cap and driver workarounds.

| Setting | Default | Level | Controls |
|---------|---------|-------|----------|
| `fast_idle` | `10000.0` | global | Fast idle timeout (1/100 s) before dropping to slow idle. |
| `hash_max` | `100` | global | Spatial-hash grid capacity for neighbour searches. |
| `idle_delay` | `1.5` | global | Seconds of inactivity before entering idle animation. |
| `keep_alive` | `off (0)` | global | Keep the render loop running even when idle. |
| `max_threads` | `1` | object | Maximum worker threads for parallel tasks. |
| `max_ups` | `0` | global | Cap on updates-per-second of the main loop (0 = uncapped). |
| `no_idle` | `2000.0` | global | Delay (1/500 s) before any idle processing starts. |
| `normal_workaround` | `off (0)` | global | Enable a surface-normal driver workaround. |
| `nvidia_bugs` | `0` | global | Enable NVIDIA driver bug workarounds. |

## fetch

**Fetch (remote structure download).** Where and how `fetch` downloads structures from a remote server.

| Setting | Default | Level | Controls |
|---------|---------|-------|----------|
| `fetch_host` | `pdb` | global | Remote host/alias used by `fetch` (e.g. 'pdb'). |
| `fetch_path` | `.` | global | Local directory where `fetch` saves downloaded files. |
| `fetch_type_default` | `cif` | global | Default file type fetched when unspecified (e.g. 'cif'). |

## camera-display

**Camera, fog & background.** Global camera projection, depth-cue fog and background opacity. `field_of_view`, `fog`/`fog_start` and `opaque_background` are wired into the TS renderer.

| Setting | Default | Level | Controls |
|---------|---------|-------|----------|
| `field_of_view` | `20.0` | global | Vertical camera field of view in degrees (perspective). |
| `fog` | `1.0` | global | Depth-cue fog strength multiplier (1=normal). |
| `fog_start` | `0.45` | global | Front position (0–1 of the slab) where fog begins. |
| `gamma` | `1.0` | global | Display gamma correction applied to the rendered image. |
| `opaque_background` | `off (0)` | global | Force an opaque background (0 allows alpha/transparent PNG). |

## fitting-alignment

**Fitting & superposition.** Convergence and algorithm choices for `fit`/`intra_fit`/`align` least-squares superposition, plus the object matrix combination mode.

| Setting | Default | Level | Controls |
|---------|---------|-------|----------|
| `fit_iterations` | `1000` | global | Max iterations for outlier-rejecting refinement in `fit`/`align`. |
| `fit_kabsch` | `0` | global | Use the Kabsch algorithm for the least-squares fit. |
| `fit_tolerance` | `0.0000001` | global | RMS convergence tolerance for the fit refinement loop. |
| `matrix_mode` | `-1` | ostate | How object matrices combine (-1 legacy / 0 history / 1 coord-mod ...). |

## label

**Labels.** Everything about atom/measurement label appearance: colour, size, font, digit precision, background box, connector lines, multiline layout and 3-D placement relative to the anchor atom.

| Setting | Default | Level | Controls |
|---------|---------|-------|----------|
| `float_labels` | `0` | ostate | Draw labels floating above geometry (depth-independent). |
| `label_anchor` | `CA` | global | Atom name used to anchor a residue's label (e.g. 'CA'). |
| `label_angle_digits` | `-1` | ostate | Decimal digits for angle labels (-1 = use label_digits). |
| `label_bg_color` | `-1` | astate | Label background box colour (-1 = none). |
| `label_bg_outline` | `off (0)` | astate | Draw an outline around the label background box. |
| `label_bg_transparency` | `.6` | astate | Transparency of the label background box. |
| `label_color` | `-6` | atom | Label text colour (-6 = 'front' default). |
| `label_connector` | `off (0)` | astate | Draw a connector line from label to its anchor atom. |
| `label_connector_color` | `-6` | astate | Colour of the label connector line (-6 = front). |
| `label_connector_ext_length` | `2.5` | astate | Extension length of the connector beyond the label. |
| `label_connector_mode` | `0` | astate | Connector routing style (0–4). |
| `label_connector_width` | `2.` | astate | Line width of the label connector. |
| `label_digits` | `1` | ostate | Default decimal digits shown in numeric labels. |
| `label_dihedral_digits` | `-1` | ostate | Decimal digits for dihedral labels (-1 = use label_digits). |
| `label_distance_digits` | `-1` | ostate | Decimal digits for distance labels (-1 = use label_digits). |
| `label_font_id` | `5` | ostate | Font index used to render labels. |
| `label_multiline_justification` | `1.` | astate | Horizontal justification of multiline labels. |
| `label_multiline_spacing` | `1.2` | astate | Line-spacing factor for multiline labels. |
| `label_outline_color` | `-1` | ostate | Outline colour for label glyphs (-1 = none). |
| `label_padding` | `[0.2, 0.2, 0.0]` | astate | Padding [x,y,z] around label text within its box. |
| `label_placement_offset` | `[0., 0., 0.]` | astate | Additional [x,y,z] offset applied to label placement. |
| `label_position` | `[0.0, 0.0, 1.75]` | astate | Label position offset [x,y,z] relative to the anchor atom. |
| `label_relative_mode` | `0` | astate | Interpret label_position relative to screen/atom (0–2). |
| `label_screen_point` | `[0., 0., 0.]` | astate | Fixed screen anchor point [x,y,z] for the label. |
| `label_shadow_mode` | `0` | global | Whether labels cast/receive shadows in ray tracing. |
| `label_size` | `14.0` | ostate | Label text size (points; negative = world units). |
| `label_z_target` | `0` | astate | Z-target mode used when depth-placing labels. |

## movie

**Movies & playback.** Movie storage, interpolation, playback rate, looping, rocking and the movie panel UI.

| Setting | Default | Level | Controls |
|---------|---------|-------|----------|
| `frame` | `1` | global | Current movie frame number. |
| `movie_animate_by_frame` | `off (0)` | global | Animate by frame rather than by state. |
| `movie_auto_interpolate` | `on (1)` | object | Auto-interpolate camera between movie keyframes. |
| `movie_auto_store` | `-1` | object | Auto-store frames into the movie cache (-1 = auto). |
| `movie_delay` | `30.0` | global | Delay between movie frames (ms) when not fps-driven. |
| `movie_fps` | `30.0` | global | Target movie playback frame rate. |
| `movie_loop` | `on (1)` | object | Loop the movie on reaching the end. |
| `movie_panel` | `1` | global | Show the movie timeline panel. |
| `movie_panel_row_height` | `15` | global | Row height (px) of the movie panel. |
| `movie_quality` | `90` | global | Encoding quality for exported movies (0–100). |
| `movie_rock` | `-1` | global | Rocking motion mode for the movie (-1 = off). |

## gaussian

**Gaussian (map generation).** Parameters for Gaussian-based map generation (e.g. `map_new ... gaussian`): B-factor adjustment/floor and sampling resolution.

| Setting | Default | Level | Controls |
|---------|---------|-------|----------|
| `gaussian_b_adjust` | `0.0` | global | B-factor offset added when building Gaussian maps. |
| `gaussian_b_floor` | `0.0` | global | Minimum B-factor clamp for Gaussian map generation. |
| `gaussian_resolution` | `2.0` | global | Effective resolution of generated Gaussian maps. |

## file-io

**File I/O & import.** Defaults for reading/importing structures and images: property loading, MOE chain splitting, multi-object multiplexing, geometry export and image DPI/clipboard behaviour.

| Setting | Default | Level | Controls |
|---------|---------|-------|----------|
| `geometry_export_mode` | `0` | global | Mode/format used when exporting geometry. |
| `image_copy_always` | `off (0)` | global | Always copy rendered images to the clipboard. |
| `image_dots_per_inch` | `0.0` | global | DPI metadata written into exported images (0 = none). |
| `load_atom_props_default` | `*` | global | Atom properties auto-loaded by default ('*' = all). |
| `load_object_props_default` | `*` | global | Object properties auto-loaded by default ('*' = all). |
| `moe_separate_chains` | `-1` | global | Split MOE-imported structures into separate chains (-1 auto). |
| `multiplex` | `-1` | global | Load multi-model files as separate objects (-1 auto). |

## gradient

**Gradient / ramp tracing.** Field/gradient line tracing used by the `gradient` representation on maps: length bounds, slope/normal thresholds, sampling spacing and step size.

| Setting | Default | Level | Controls |
|---------|---------|-------|----------|
| `gradient_max_length` | `100.0` | ostate | Maximum length of a traced gradient line. |
| `gradient_min_length` | `2.0` | ostate | Minimum length before a gradient line is kept. |
| `gradient_min_slope` | `0.00001` | ostate | Minimum field slope to continue tracing. |
| `gradient_normal_min_dot` | `0.70` | ostate | Min normal dot-product to continue a gradient trace. |
| `gradient_spacing` | `3` | ostate | Grid spacing (in voxels) between seeded gradient lines. |
| `gradient_step_size` | `0.25` | ostate | Integration step size along a gradient line. |
| `gradient_symmetry` | `0.0` | ostate | Symmetry constraint applied to gradient tracing. |

## grid

**Grid (tiled multi-object) mode.** `grid_mode` tiles multiple objects/states into a grid of viewports; these control activation, capacity and per-object slot assignment.

| Setting | Default | Level | Controls |
|---------|---------|-------|----------|
| `grid_max` | `-1` | global | Maximum number of grid slots (-1 = auto). |
| `grid_mode` | `0` | global | Grid layout mode (0 off, 1 by object, 2 by state, 3 by object+state). |
| `grid_slot` | `-1` | object | Explicit grid slot assignment for an object (-1 = auto). |

## group

**Object groups.** Behaviour of object groups: arrow prefixes in the panel, auto-grouping and full member-name qualification.

| Setting | Default | Level | Controls |
|---------|---------|-------|----------|
| `group_arrow_prefix` | `off (0)` | global | Prefix group children with an arrow glyph in the panel. |
| `group_auto_mode` | `1` | global | Auto-group objects by name prefix (0/1/2). |
| `group_full_member_names` | `0` | global | Use fully-qualified member names within groups. |

## h-bond

**Hydrogen-bond detection.** Geometric criteria PyMOL uses to detect hydrogen bonds (for `distance ... mode=2`, `dss`, polar-contact wizard): distance cutoffs, angle limits and the potential's power terms.

| Setting | Default | Level | Controls |
|---------|---------|-------|----------|
| `h_bond_cone` | `180.0` | global | Angular cone (deg) tolerated around the ideal H-bond. |
| `h_bond_cutoff_center` | `3.6` | global | Ideal donor–acceptor distance (Å) at cone centre. |
| `h_bond_cutoff_edge` | `3.2` | global | Maximum donor–acceptor distance (Å) at cone edge. |
| `h_bond_exclusion` | `3` | global | Min bonds separating atoms to allow an H-bond. |
| `h_bond_from_proton` | `on (1)` | global | Measure the H-bond angle from the proton position. |
| `h_bond_max_angle` | `63.0` | global | Maximum deviation angle (deg) for a valid H-bond. |
| `h_bond_power_a` | `1.6` | global | Exponent A in the H-bond distance/angle potential. |
| `h_bond_power_b` | `5.0` | global | Exponent B in the H-bond distance/angle potential. |

## bonds-display

**Bond display.** Display of bonds: half-bond colouring and hiding of over-length bonds.

| Setting | Default | Level | Controls |
|---------|---------|-------|----------|
| `half_bonds` | `off (0)` | ostate | Split bonds at midpoint into two atom-coloured halves. |
| `hide_long_bonds` | `off (0)` | ostate | Do not draw bonds longer than the expected length. |

## halogen-bond

**Halogen-bond detection.** Geometric criteria for halogen-bond detection, split by whether the halogen acts as donor or acceptor.

| Setting | Default | Level | Controls |
|---------|---------|-------|----------|
| `halogen_bond_as_acceptor_max_acceptor_angle` | `170.0` | global | Max acceptor angle when halogen is acceptor. |
| `halogen_bond_as_acceptor_min_acceptor_angle` | `90.0` | global | Min acceptor angle when halogen is acceptor. |
| `halogen_bond_as_acceptor_min_donor_angle` | `120.0` | global | Min donor angle when halogen is acceptor. |
| `halogen_bond_as_donor_min_acceptor_angle` | `90.0` | global | Min acceptor angle when halogen is donor. |
| `halogen_bond_as_donor_min_donor_angle` | `140.0` | global | Min donor angle when halogen is donor. |
| `halogen_bond_distance` | `3.5` | global | Max halogen-bond distance (Å). |

## proximity

**Proximity cutoffs.** Distance cutoffs used when inferring bonds/contacts from atom proximity.

| Setting | Default | Level | Controls |
|---------|---------|-------|----------|
| `heavy_neighbor_cutoff` | `3.5` | global | Distance cutoff for heavy-atom neighbour inference. |
| `neighbor_cutoff` | `3.5` | global | General distance cutoff for neighbour/bond inference. |

## selecting

**Selection matching.** Case-sensitivity and segi handling used during selection-language matching and PDB import.

| Setting | Default | Level | Controls |
|---------|---------|-------|----------|
| `hide_underscore_names` | `on (1)` | global | Hide objects/selections whose names start with '_'. |
| `ignore_case` | `on (1)` | global | Case-insensitive matching of names/identifiers in selections. |
| `ignore_case_chain` | `off (0)` | global | Case-insensitive matching specifically for chain IDs. |
| `ignore_pdb_segi` | `off (0)` | global | Ignore the PDB segment identifier on import. |

## internal-gui

**Internal GUI (OpenGL widgets).** The legacy in-viewport OpenGL GUI (object menu panel on the right): visibility, sizing, mode and colour behaviour.

| Setting | Default | Level | Controls |
|---------|---------|-------|----------|
| `internal_feedback` | `1` | global | Number of feedback text lines shown in the viewport. |
| `internal_gui` | `on (1)` | object | Show the internal (in-viewport) object menu panel. |
| `internal_gui_control_size` | `18` | global | Size (px) of internal GUI control rows. |
| `internal_gui_mode` | `0` | global | Internal GUI rendering mode. |
| `internal_gui_name_color_mode` | `0` | global | How object names are colourised in the panel (0–2). |
| `internal_gui_width` | `220` (`cOrthoRightSceneMargin`, DIP) | global | Width (px) of the internal GUI panel. |
| `internal_prompt` | `on (1)` | global | Show the internal command prompt line. |

## mesh

**Isomesh / mesh representation.** The `mesh`/`isomesh` representation and carving: contour cutoff, grid resolution, line width, quality, solvent handling, negative-contour colour, and carve/clear-by-selection controls.

| Setting | Default | Level | Controls |
|---------|---------|-------|----------|
| `isomesh_auto_state` | `off (0)` | global | Auto-track the current state for `isomesh` maps. |
| `mesh_as_cylinders` | `off (0)` | global | Render mesh edges as shader cylinders. |
| `mesh_carve_cutoff` | `0.0` | ostate | Distance cutoff for carving mesh around a selection. |
| `mesh_carve_selection` | `"" (empty)` | ostate | Selection used to carve (keep-near) the mesh. |
| `mesh_carve_state` | `0` | ostate | State used for the mesh carve selection. |
| `mesh_clear_cutoff` | `0.0` | ostate | Distance cutoff for clearing mesh near a selection. |
| `mesh_clear_selection` | `"" (empty)` | ostate | Selection used to clear (remove-near) the mesh. |
| `mesh_clear_state` | `0` | ostate | State used for the mesh clear selection. |
| `mesh_color` | `-1` | atom | Mesh colour (-1 = use object/atom colour). |
| `mesh_cutoff` | `0.0` | ostate | Density/contour cutoff for the mesh isosurface. |
| `mesh_grid_max` | `80` | ostate | Maximum grid dimension when generating the mesh. |
| `mesh_lighting` | `off (0)` | ostate | Apply lighting/shading to mesh lines. |
| `mesh_mode` | `0` | ostate | Mesh generation mode (0 = by flag default). |
| `mesh_negative_color` | `red` | object | Colour for the negative contour of a signed map. |
| `mesh_negative_visible` | `off (0)` | object | Show the negative contour of a signed map. |
| `mesh_normals` | `on (1)` | ostate | Compute vertex normals for the mesh. |
| `mesh_quality` | `2` | ostate | Mesh tessellation quality level. |
| `mesh_radius` | `0.000` | ostate | Mesh line radius (0 = use mesh_width pixels). |
| `mesh_skip` | `0` | ostate | Skip factor to decimate mesh lines. |
| `mesh_solvent` | `0` | ostate | Generate a solvent-excluded mesh surface. |
| `mesh_type` | `0` | ostate | Mesh type (0 isomesh lines / 1 dots). |
| `mesh_use_shader` | `on (1)` | global | Use the GLSL shader path for meshes. |
| `mesh_width` | `1.0` | ostate | Mesh line width in pixels. |
| `min_mesh_spacing` | `0.6` | ostate | Minimum grid spacing allowed when meshing. |

## map-io

**Map normalisation & isosurfacing.** Normalisation of imported maps by format, plus symmetry expansion and the marching-cubes isosurface algorithm selection.

| Setting | Default | Level | Controls |
|---------|---------|-------|----------|
| `isosurface_algorithm` | `0` | global | Marching-cubes variant used for isosurfaces (0–2). |
| `map_auto_expand_sym` | `on (1)` | object | Auto-expand map by crystal symmetry on load. |
| `normalize_ccp4_maps` | `1` | global | Normalise CCP4/MRC maps to sigma units on load. |
| `normalize_grd_maps` | `off (0)` | global | Normalise GRD maps on load. |
| `normalize_o_maps` | `on (1)` | global | Normalise O/DSN6 maps on load. |

## mouse

**Mouse control.** Mouse interaction tuning: virtual-trackball limits/scale, wheel zoom step, z-scaling, selection mode and movie restart on click.

| Setting | Default | Level | Controls |
|---------|---------|-------|----------|
| `legacy_mouse_zoom` | `off (0)` | global | Use pre-1.x mouse-zoom direction/behaviour. |
| `mouse_grid` | `on (1)` | global | Show the mouse-mode grid/config overlay. |
| `mouse_limit` | `100.0` | global | Clamp on virtual-trackball rotation magnitude. |
| `mouse_restart_movie_delay` | `off (0)` | global | Delay before a click restarts a stopped movie. |
| `mouse_scale` | `1.3` | global | Sensitivity scale for mouse rotation/translation. |
| `mouse_selection_mode` | `1` | global | Picking granularity (atom/residue/chain/... level). |
| `mouse_wheel_scale` | `0.5` | global | Zoom step per mouse-wheel notch. |
| `mouse_z_scale` | `1.0` | global | Sensitivity of z-axis (clip/translate) mouse motion. |

## lighting

**Lighting (direction vectors).** Direction vectors for PyMOL's up-to-nine light sources and how many are active (`light_count`). `light`/`light2` feed the TS renderer's shading.

| Setting | Default | Level | Controls |
|---------|---------|-------|----------|
| `light` | `[-0.4, -0.4, -1.0]` | global | Direction vector of the primary directional light. |
| `light2` | `[-0.55, -0.7, 0.15]` | global | Direction vector of light source 2. |
| `light3` | `[0.3, -0.6, -0.2]` | global | Direction vector of light source 3. |
| `light4` | `[-1.2, 0.3, -0.2]` | global | Direction vector of light source 4. |
| `light5` | `[0.3, 0.6, -0.75]` | global | Direction vector of light source 5. |
| `light6` | `[-0.3, 0.5, 0.0]` | global | Direction vector of light source 6. |
| `light7` | `[0.9, -0.1, -0.15]` | global | Direction vector of light source 7. |
| `light8` | `[1.3, 2.0, 0.8]` | global | Direction vector of light source 8. |
| `light9` | `[-1.7, -0.5, 1.2]` | global | Direction vector of light source 9. |
| `light_count` | `2` | global | Number of active lights (1 ambient + directed; 1–10). |

## line

**Lines / wireframe representation.** The `lines`/wireframe representation: colour, radius (cylinder mode), width, smoothing, shader use and the line/stick helper.

| Setting | Default | Level | Controls |
|---------|---------|-------|----------|
| `line_as_cylinders` | `off (0)` | global | Render wireframe lines as shader cylinders. |
| `line_color` | `-1` | bond | Line/wireframe colour (-1 = use atom colour). |
| `line_radius` | `0.0` | ostate | Cylinder radius when lines are drawn as cylinders (0 = flat). |
| `line_smooth` | `on (1)` | global | Enable GL line antialiasing/smoothing. |
| `line_stick_helper` | `on (1)` | ostate | Assist line drawing where lines meet sticks. |
| `line_use_shader` | `on (1)` | global | Use the GLSL shader path for lines. |
| `line_width` | `1.49` | bond | Wireframe line width in pixels (<1.5 keeps SGI AA). |

## logging

**Logging.** What gets written to the log file: selections, conformations and the overall logging mode.

| Setting | Default | Level | Controls |
|---------|---------|-------|----------|
| `log_box_selections` | `on (1)` | global | Log box (drag) selections to the log file. |
| `log_conformations` | `on (1)` | global | Log conformational edits to the log file. |
| `logging` | `0` | global | Logging mode/verbosity (0 off, 1 .pml, 2 .py). |

## motion

**Motion / camera easing.** Easing/interpolation shaping for camera motion and `movie` keyframe interpolation (power, bias, linear blend, hand, simple mode).

| Setting | Default | Level | Controls |
|---------|---------|-------|----------|
| `motion_bias` | `-1.0` | object | Bias of keyframe interpolation easing (-1 = default). |
| `motion_hand` | `1` | object | Handedness/direction of rocking motion. |
| `motion_linear` | `0.0` | object | Blend toward linear interpolation (0–1). |
| `motion_power` | `0.0` | object | Easing power applied to motion interpolation. |
| `motion_simple` | `0` | object | Use simplified (linear) motion interpolation. |

## nb-spheres

**Nonbonded spheres representation.** The `nb_spheres` (nonbonded spheres) representation: size, tessellation quality and shader use.

| Setting | Default | Level | Controls |
|---------|---------|-------|----------|
| `nb_spheres_quality` | `1` | ostate | Tessellation quality of nonbonded spheres (0–max). |
| `nb_spheres_size` | `0.25` | ostate | Radius of nonbonded spheres. |
| `nb_spheres_use_shader` | `1` | global | Use the shader path for nonbonded spheres (0–2). |

## nonbonded

**Nonbonded representation.** The `nonbonded` (crosses) representation for atoms without bonds: size, transparency, cylinder and shader rendering.

| Setting | Default | Level | Controls |
|---------|---------|-------|----------|
| `nonbonded_as_cylinders` | `off (0)` | global | Render nonbonded crosses as shader cylinders. |
| `nonbonded_size` | `0.25` | ostate | Size of the nonbonded cross representation. |
| `nonbonded_transparency` | `0.0` | atom | Transparency of nonbonded crosses. |
| `nonbonded_use_shader` | `on (1)` | global | Use the shader path for the nonbonded representation. |

## openvr

**OpenVR (virtual reality).** OpenVR / virtual-reality subsystem settings (laser cutting, clipping, far plane, and the in-VR GUI overlay). Not part of the web/TS port.

| Setting | Default | Level | Controls |
|---------|---------|-------|----------|
| `openvr_cut_laser` | `off (0)` | global | Enable the cut laser for the VR molecule picker. |
| `openvr_disable_clipping` | `off (0)` | global | Disable near/far clipping in VR. |
| `openvr_far_plane` | `100.` | global | Far clipping plane distance in VR. |
| `openvr_gui_alpha` | `1.0` | global | Opacity of the VR GUI overlay (0–1). |
| `openvr_gui_back_alpha` | `0.75` | global | Opacity of the VR GUI backing panel. |
| `openvr_gui_back_color` | `0.2` | global | Grey level of the VR GUI backing panel. |
| `openvr_gui_distance` | `1.5` | global | Distance the VR GUI floats from the viewer. |
| `openvr_gui_fov` | `35.0` | global | Field of view of the VR GUI overlay (0–89 deg). |
| `openvr_gui_overlay` | `0` | global | VR GUI overlay mode (0 off, 1 on, 2 laser-triggered). |
