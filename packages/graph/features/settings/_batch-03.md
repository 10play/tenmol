---
name: settings-batch-03
kind: setting
category: settings
subcategory: reference-batch
summary: Grouped reference for PyMOL settings 601–779 (sdof_* through wrap_output), organised by prefix family with compiled-in defaults.
parity: partial
---

## Purpose

This batch documents the final 179 of PyMOL's 779 settings — alphabetically
`sdof_drag_scale` through `wrap_output`. It covers the sequence viewer,
session I/O, lighting/specular model, sphere/spheroid geometry,
secondary-structure detection angles, stereo, sticks, the large `surface_*`
family, transparency, valence, and volume rendering. Every default below is the
compiled-in value from `layer1/SettingInfo.h`; the *level* (global / object /
ostate / atom / bond) governs how narrowly the override can be scoped.

## Syntax

All are used through the generic setting machinery:

```
set <name>, <value>[, <selection>[, state]]
get <name>[, <selection>]
unset <name>[, <selection>]
```

`ostate` / `object` / `atom` / `bond` level settings accept a per-object,
per-state, per-atom or per-bond override; `global` settings ignore the
selection argument.

## Behaviour

Organised by prefix family. Defaults are exact from `SettingInfo.h`; a color
default of `"-1"` means "inherit atom/object color", `"front"`/`"red"` are named
colors, numeric color strings are color indices.

### sdof

Space-navigator (3D mouse) tuning.

| Setting | Default | Controls |
| --- | --- | --- |
| `sdof_drag_scale` | 0.5 | Sensitivity scale applied to SpaceNavigator drag input. |

### secondary-structure

Assignment mode and the geometric φ/ψ tolerances used by `dss`.

| Setting | Default | Controls |
| --- | --- | --- |
| `secondary_structure` | 2 | SS assignment source/mode when loading (1–4). |
| `ss_helix_phi_target` | -57.0 | Ideal helix φ angle. |
| `ss_helix_phi_include` | 55.0 | φ half-window within which a residue fully counts as helix. |
| `ss_helix_phi_exclude` | 85.0 | φ half-window beyond which helix is rejected. |
| `ss_helix_psi_target` | -48.0 | Ideal helix ψ angle. |
| `ss_helix_psi_include` | 55.0 | ψ helix include half-window. |
| `ss_helix_psi_exclude` | 85.0 | ψ helix exclude half-window. |
| `ss_strand_phi_target` | -129.0 | Ideal β-strand φ angle. |
| `ss_strand_phi_include` | 40.0 | φ strand include half-window. |
| `ss_strand_phi_exclude` | 100.0 | φ strand exclude half-window. |
| `ss_strand_psi_target` | 124.0 | Ideal β-strand ψ angle. |
| `ss_strand_psi_include` | 40.0 | ψ strand include half-window. |
| `ss_strand_psi_exclude` | 90.0 | ψ strand exclude half-window. |

### system

Runtime/system flags and counters.

| Setting | Default | Controls |
| --- | --- | --- |
| `security` | 1 | Guards execution of embedded/scripted code (1 = prompt/restrict). |
| `sel_counter` | 0 | Internal counter for auto-named selections (`sele01`, …). |
| `slow_idle` | 40000.0 | Idle threshold in microseconds (~1/25 s) before slow-idle work runs. |
| `stop_on_exceptions` | 0 | Halt command execution on a Python exception rather than continuing. |
| `suspend_deferred` | 0 | Suspend deferred (builds/updates) processing. |
| `suspend_undo` | 0 | Suspend undo capture (object-level). |
| `suspend_undo_atom_count` | 1000 | Auto-suspend undo when an edit touches more atoms than this. |
| `suspend_updates` | 0 | Freeze scene/geometry updates until unset. |
| `validate_object_names` | 1 | Reject/normalise illegal characters in new object names. |
| `wrap_output` | 0 | Word-wrap text written to the output feedback pane. |

### selection-display

Appearance of the active-selection indicator dots/points.

| Setting | Default | Controls |
| --- | --- | --- |
| `selection_overlay` | 1.0 | Draw selection indicators over (in front of) geometry. |
| `selection_round_points` | 0 | Render selection indicators as round rather than square points. |
| `selection_visible_only` | 0 | Only indicate atoms that are currently displayed. |
| `selection_width` | 3.0 | Base pixel size of selection indicator dots. |
| `selection_width_max` | 10.0 | Upper clamp for scaled selection dot size. |
| `selection_width_scale` | 2.0 | Zoom-dependent scale factor for selection dot size. |

### sequence-view

The on-screen sequence viewer (`set seq_view, 1`) and its layout/coloring.

| Setting | Default | Controls |
| --- | --- | --- |
| `seq_view` | 0 | Master toggle for the sequence viewer (object-level). |
| `seq_view_alignment` | "" | Named alignment object to drive multi-row aligned display. |
| `seq_view_color` | -1 | Color of sequence text (-1 = default/front). |
| `seq_view_discrete_by_state` | 1 | Treat multi-state objects as discrete rows per state. |
| `seq_view_fill_char` | "-" | Character used to pad gaps. |
| `seq_view_fill_color` | 104 | Color index for gap fill characters. |
| `seq_view_format` | 0 | Row content: 0 codes, 1 residue names, 2 atom names, 3 chains. |
| `seq_view_gap_mode` | 1 | How alignment gaps are drawn/collapsed. |
| `seq_view_label_color` | front | Color of the row labels. |
| `seq_view_label_mode` | 2 | What labels accompany rows (object/chain/etc.). |
| `seq_view_label_spacing` | 5 | Residue-number label interval. |
| `seq_view_label_start` | 1 | First residue number shown as a label. |
| `seq_view_location` | 0 | Viewer placement (0 bottom, 1 top). |
| `seq_view_overlay` | 0 | Overlay the sequence on the 3D view instead of reserving space. |
| `seq_view_unaligned_color` | -1 | Color for residues outside the alignment. |
| `seq_view_unaligned_mode` | 0 | How unaligned residues are shown relative to aligned columns. |
| `trace_atoms_mode` | 5 | Which atoms define the trace/sequence row (CA selection heuristic). |

### session

Session-file (`.pse`) save/load behaviour.

| Setting | Default | Controls |
| --- | --- | --- |
| `session_cache_optimize` | 0 | Optimise/deduplicate cached data when writing a session. |
| `session_changed` | 0 | Dirty flag: set when the session diverges from the saved file. |
| `session_compression` | 0 | Compress session payloads on save. |
| `session_embeds_data` | 1 | Embed loaded map/data blobs into the session file. |
| `session_file` | "" | Path of the most recently loaded/saved session. |
| `session_migration` | 1 | Upgrade older-version session data on load. |
| `session_version_check` | 0 | Warn on version mismatch when loading a session. |

### shaders

GLSL shader-pipeline toggles.

| Setting | Default | Controls |
| --- | --- | --- |
| `shaders_from_disk` | 0 | Load shader source from disk (dev) instead of compiled-in. |
| `use_shaders` | 0 | Master shader-path toggle (ostate). |
| `use_geometry_shaders` | 1 | Permit geometry-shader draw paths. |
| `use_tessellation_shaders` | true | Permit tessellation-shader draw paths. |

### lighting

Specular/shininess model and reflectance.

| Setting | Default | Controls |
| --- | --- | --- |
| `shininess` | 55.0 | Specular exponent (highlight tightness). |
| `spec_count` | -1 | Number of specular reflections (-1 = follow light_count). |
| `spec_direct` | 0.0 | Direct specular contribution toward the camera. |
| `spec_direct_power` | 55.0 | Exponent for the direct specular term. |
| `spec_power` | -1.0 | Specular exponent for ray tracing (-1 = use shininess). |
| `spec_reflect` | -1.0 | Specular reflectance intensity (-1 = auto from specular). |
| `specular` | 1.0 | Global specular on/intensity master. |
| `specular_intensity` | 0.5 | Specular highlight intensity. |
| `two_sided_lighting` | -1 | Light back faces too (-1 = auto, e.g. on for surfaces). |

### display-feedback

On-screen progress/rate indicators and framebuffer flags.

| Setting | Default | Controls |
| --- | --- | --- |
| `show_alpha_checker` | 1 | Draw the checkerboard behind transparent-background renders. |
| `show_frame_rate` | 0 | Overlay a live FPS counter. |
| `show_progress` | 1 | Show progress bars for long operations (surface, ray). |
| `single_image` | 0 | Render/hold a single static image (no continuous redraw). |
| `suppress_hidden` | true | Skip hidden reps when composing geometry (perf). |

### slice

Volumetric slice-plane objects.

| Setting | Default | Controls |
| --- | --- | --- |
| `slice_dynamic_grid` | 0 | Recompute slice sampling grid dynamically. |
| `slice_dynamic_grid_resolution` | 3.0 | Grid resolution when dynamic gridding is on. |
| `slice_grid` | 0.3 | Static slice sampling spacing (Å). |
| `slice_height_map` | 0 | Render the slice as a height field. |
| `slice_height_scale` | 1.0 | Vertical exaggeration of the height map. |
| `slice_track_camera` | 0 | Keep the slice plane facing the camera. |

### rendering

Miscellaneous triangle/color rendering flags.

| Setting | Default | Controls |
| --- | --- | --- |
| `smooth_color_triangle` | 0 | Gouraud-interpolate color across ray-traced triangles. |
| `smooth_half_bonds` | 1 | Blend the two half-bond colors across the bond midpoint. |
| `triangle_max_passes` | 5 | Max smoothing passes for surface/triangle mesh generation. |
| `trilines` | 0 | Use triangle-based (thick) line rendering. |

### surface (solvent radius)

| Setting | Default | Controls |
| --- | --- | --- |
| `solvent_radius` | 1.4 | Probe radius (Å) for solvent-accessible/molecular surfaces. |

### sphere

The sphere (VDW) representation.

| Setting | Default | Controls |
| --- | --- | --- |
| `sphere_color` | -1 | Sphere color override (-1 = atom color). |
| `sphere_mode` | 9 | Sphere draw path (-1..11; impostor vs geometry variants). |
| `sphere_point_max_size` | 18.0 | Max pixel size when spheres draw as points. |
| `sphere_point_size` | 1.0 | Base point size for point-mode spheres. |
| `sphere_quality` | 1 | Tessellation subdivision level (0..MAX_SPHERE_QUALITY). |
| `sphere_scale` | 1.0 | Multiplier on VDW radius for sphere rep. |
| `sphere_solvent` | 0 | Add the solvent radius to sphere radii. |
| `sphere_transparency` | 0.0 | Per-atom sphere transparency (0 opaque … 1 clear). |
| `sphere_use_shader` | 1 | Use the shader impostor path for spheres. |

### spheroid

Ellipsoidal spheroid (ADP) rendering.

| Setting | Default | Controls |
| --- | --- | --- |
| `spheroid_fill` | 1.30 | Fill factor for spheroid density fitting. |
| `spheroid_scale` | 1.0 | Overall spheroid size multiplier. |
| `spheroid_smooth` | 1.1 | Smoothing applied to spheroid surface. |

### states

State selection and counters.

| Setting | Default | Controls |
| --- | --- | --- |
| `state` | 1 | Current/displayed object state (1-based; 0 = all). |
| `state_counter_mode` | -1 | On-screen state counter format (-1/1 fraction, 0 off, 2 index-only). |
| `static_singletons` | 1 | Show single-state objects in every state (don't blank between frames). |

### stereo

Stereoscopic display parameters.

| Setting | Default | Controls |
| --- | --- | --- |
| `stereo` | 0 | Master stereo toggle. |
| `stereo_angle` | 2.1 | Convergence/toe-in angle (degrees). |
| `stereo_double_pump_mono` | 0 | Double-pump a mono buffer for certain stereo hardware. |
| `stereo_dynamic_strength` | 0.5 | Strength of dynamic-depth stereo modes. |
| `stereo_mode` | 2 | Stereo method (1..13; 2 = cross-eye default). |
| `stereo_shift` | 2.0 | Camera separation shift for stereo pairs. |

### stick

The stick / ball-and-stick representation.

| Setting | Default | Controls |
| --- | --- | --- |
| `stick_as_cylinders` | 1 | Draw sticks as true cylinders (shader path). |
| `stick_ball` | false | Enable ball-and-stick (spheres at atoms). |
| `stick_ball_color` | -1 | Ball color override in ball-and-stick. |
| `stick_ball_ratio` | 1.0 | Ball radius relative to stick radius (VDW = -1). |
| `stick_color` | -1 | Stick color override (bond-level; -1 = atom color). |
| `stick_debug` | 0 | Draw debug geometry for stick generation. |
| `stick_fixed_radius` | false | Ignore per-bond radius scaling; use a fixed radius. |
| `stick_good_geometry` | 0 | Prefer higher-quality (costlier) stick joins. |
| `stick_h_scale` | 0.4 | Radius scale for bonds to hydrogens. |
| `stick_nub` | 0.7 | Length of the capping nub at open stick ends. |
| `stick_overlap` | 0.2 | Overlap between stick segments to hide seams. |
| `stick_quality` | 8 | Cylinder tessellation (3..100). |
| `stick_radius` | 0.25 | Stick cylinder radius (Å), bond-level. |
| `stick_round_nub` | 0 | Round rather than flat stick end caps. |
| `stick_transparency` | 0.0 | Per-bond stick transparency. |
| `stick_use_shader` | 1 | Use the shader cylinder path for sticks. |
| `stick_valence_scale` | 1.0 | Spacing scale for multiple-bond valence lines. |

### surface

The molecular/solvent surface representation and its carve/clear/cavity controls.

| Setting | Default | Controls |
| --- | --- | --- |
| `surface_best` | 0.25 | Triangle spacing (Å) at the "best" quality preset. |
| `surface_poor` | 0.85 | Triangle spacing at the "poor" quality preset. |
| `surface_miserable` | 2.0 | Triangle spacing at the coarsest preset. |
| `surface_quality` | 0 | Quality tier selector (higher = finer; picks spacing preset). |
| `surface_type` | 0 | Surface style: 0 solid, 1 dot, 2 wireframe. |
| `surface_mode` | 0 | Atom-inclusion mode (by-flag default; HETATM/H ignore variants). |
| `surface_color` | -1 | Surface color override (-1 = atom color). |
| `surface_color_smoothing` | 1 | Smooth per-vertex surface colors. |
| `surface_color_smoothing_threshold` | 0.05 | Color-difference threshold below which smoothing applies. |
| `surface_normal` | 0.5 | Normal-vector smoothing radius. |
| `surface_solvent` | 0 | Compute a solvent-accessible (vs molecular) surface. |
| `surface_proximity` | 1 | Require edge/vertex proximity when trimming surface patches. |
| `surface_smooth_edges` | 1 | Smooth surface patch boundaries. |
| `surface_optimize_subsets` | 1 | Optimise surfacing of selected atom subsets. |
| `surface_circumscribe` | -1 | Extra circumscribing pass control (-1 = auto). |
| `surface_debug` | 0 | Emit surface-generation debug geometry. |
| `surface_residue_cutoff` | 2.5 | Distance cutoff (Å) grouping residues into a surface patch. |
| `surface_ramp_above_mode` | 0 | Ramp behaviour above the surface color threshold. |
| `surface_carve_selection` | "" | Selection whose neighbourhood the surface is carved to. |
| `surface_carve_cutoff` | 0.0 | Carve radius (Å) around the carve selection. |
| `surface_carve_normal_cutoff` | -1.0 | Normal-alignment cutoff for carving (-1 = off). |
| `surface_carve_state` | 0 | State providing the carve selection. |
| `surface_clear_selection` | "" | Selection whose neighbourhood is cleared (removed) from surface. |
| `surface_clear_cutoff` | 0.0 | Clear radius (Å) around the clear selection. |
| `surface_clear_state` | 0 | State providing the clear selection. |
| `surface_cavity_mode` | 0 | Cavity display: 0 exterior, 1 cavities/pockets only, 2 culled. |
| `surface_cavity_cutoff` | -3.0 | Cavity detection cutoff (solvent-radius units). |
| `surface_cavity_radius` | 7.0 | Cavity detection probe radius. |
| `surface_negative_color` | red | Color for the negative side of a signed (map) surface. |
| `surface_negative_visible` | 0 | Show the negative-value surface lobe. |
| `surface_trim_cutoff` | 0.2 | Cutoff for trimming small/dangling surface fragments. |
| `surface_trim_factor` | 2.0 | Aggressiveness of surface trimming. |
| `surface_use_shader` | 1 | Use the shader path for surface rendering. |

### swap-dsn6

| Setting | Default | Controls |
| --- | --- | --- |
| `swap_dsn6_bytes` | 1 | Byte-swap DSN6/BRIX map files on load (endianness). |

### sweep

Rocking/sweep camera animation.

| Setting | Default | Controls |
| --- | --- | --- |
| `sweep_angle` | 20.0 | Amplitude of the sweep/rock in degrees. |
| `sweep_mode` | 0 | Sweep axis/pattern selector. |
| `sweep_phase` | 0.0 | Phase offset of the sweep cycle. |
| `sweep_speed` | 0.75 | Sweep oscillation speed. |

### debug

Developer/test flags.

| Setting | Default | Controls |
| --- | --- | --- |
| `test1` | 3.0 | Scratch float used in engine test/debug paths. |
| `test2` | -0.5 | Scratch float used in engine test/debug paths. |
| `text` | 0 | Text-only/debug rendering toggle. |

### transparency

Global transparency of the surface rep and how transparency is sorted/composed.

| Setting | Default | Controls |
| --- | --- | --- |
| `transparency` | 0.0 | Surface transparency (0 opaque … 1 clear), atom-level. |
| `transparency_global_sort` | 0 | Depth-sort transparent geometry globally across objects. |
| `transparency_mode` | 2 | Blending method (2 = default order-independent-ish path). |
| `transparency_picking_mode` | 2 | Picking behaviour through transparent surfaces (2 = auto). |

### dots

| Setting | Default | Controls |
| --- | --- | --- |
| `trim_dots` | 1 | Trim dot-surface dots that fall inside neighbouring atoms. |

### valence

Multiple-bond (valence) line rendering.

| Setting | Default | Controls |
| --- | --- | --- |
| `valence` | 1 | Draw double/triple bonds as multiple lines (bond-level). |
| `valence_mode` | 1 | Valence-line placement algorithm. |
| `valence_size` | 0.060 | Offset spacing between valence lines. |
| `valence_zero_mode` | 1 | Zero-order bond style: 0 skip, 1 dashed, 2 solid. |
| `valence_zero_scale` | 0.2 | Radius/scale for zero-order bond sticks. |

### camera

| Setting | Default | Controls |
| --- | --- | --- |
| `virtual_trackball` | 1 | Use virtual-trackball rotation mapping for mouse drags. |

### volume

Direct volume rendering.

| Setting | Default | Controls |
| --- | --- | --- |
| `volume_bit_depth` | 16 | Texture bit depth for the volume (object-level). |
| `volume_data_range` | 5.0 | Data value range mapped by the transfer function. |
| `volume_layers` | 256.0 | Number of sampling slabs/layers through the volume. |
| `volume_mode` | 1 | Volume rendering path (0 = pre-integrated off in open source). |

### wildcard

| Setting | Default | Controls |
| --- | --- | --- |
| `wildcard` | "*" | Wildcard character recognised in selection identifier matching. |

### wizard

| Setting | Default | Controls |
| --- | --- | --- |
| `wizard_prompt_mode` | 1 | How wizard prompts are surfaced in the GUI. |

## Examples

```
# Finer, opaque solvent surface probed at a smaller radius
set surface_quality, 2
set solvent_radius, 1.2
set transparency, 0.0
show surface, polymer

# Ball-and-stick with slim sticks
set stick_ball, 1
set stick_radius, 0.14
set stick_ball_ratio, 1.5

# Turn on the sequence viewer as an overlay
set seq_view, 1
set seq_view_overlay, 1
```

## Related

- [settings-batch-02](./_batch-02.md) — the preceding settings block.
- Prose and GUI mappings: `docs/settings-colors.md`.

## Source

Defaults and levels: `packages/engine/layer1/SettingInfo.h` (indices per row).
Parity: settings are stored/round-tripped generically by
`packages/engine-ts/src/cmd/settings2.ts`; geometry/lighting settings
(`stick_*`, `sphere_*`, `surface_*`, `transparency`, `valence`, `solvent_radius`,
`shininess`, `specular*`, `two_sided_lighting`) are consumed by the TS render
port, while sequence-viewer, stereo, slice, volume, shader and session settings
are stored but not yet rendered.
