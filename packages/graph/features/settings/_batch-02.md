---
name: settings-batch-02
kind: setting
category: settings
subcategory: settings-reference
summary: "Reference for PyMOL settings 401-600 (openvr, pdb, picking, ray, ribbon, roving, scene, sculpt families), grouped by prefix with defaults and meaning."
parity: partial
---

# Settings reference — batch 02 (settings 401-600)

Grouped by prefix family. Defaults are taken verbatim from `packages/engine/layer1/SettingInfo.h` (the static `SettingInfo[]` table). Boolean defaults are shown as `0`/`1`; `-1` on many ray/scene settings means "inherit the corresponding global setting". Settings are stored and introspected through the tenmol settings bridge (`packages/bridge/tenmol_bridge/panels/settings.py`, `packages/stores/src/settings.ts`); only a handful are individually consumed by the TypeScript render/engine port so far.

## OpenVR display {#openvr}

| Setting | Default | Controls |
| --- | --- | --- |
| `openvr_gui_scene_alpha` | `0.75` | Opacity of the in-headset scene/GUI panel. |
| `openvr_gui_scene_color` | `0.0` | Colour of the in-headset scene GUI backdrop. |
| `openvr_gui_text` | `0` | Text-rendering mode for the VR GUI. |
| `openvr_gui_use_alpha` | `0` | Whether the VR GUI panel is alpha-blended (0/1/2). |
| `openvr_gui_use_backdrop` | `0` | Whether the VR GUI draws a backdrop (0/1/2). |
| `openvr_laser_width` | `3.0` | Pixel width of the VR pointer laser. |
| `openvr_near_plane` | `0.1` | Near clipping-plane distance for the VR view. |

## Camera & display miscellany {#display}

| Setting | Default | Controls |
| --- | --- | --- |
| `orthoscopic` | `0` | Use orthographic (non-perspective) projection when on. |
| `overlay` | `0` | Number of lines of console text overlaid on the viewport (0/1/3/5). |
| `overlay_lines` | `5` | Maximum number of overlay text lines retained. |
| `precomputed_lighting` | `0` | Use a precomputed lighting texture for shader rendering. |

## PDB / PQR file I/O {#pdb}

| Setting | Default | Controls |
| --- | --- | --- |
| `pdb_conect_all` | `0` | Write CONECT records for all bonds, not just non-standard ones. |
| `pdb_conect_nodup` | `1` | Suppress duplicate CONECT entries on export. |
| `pdb_discrete_chains` | `-1` | Assign discrete chain IDs on load (-1 = auto). |
| `pdb_echo_tags` | `HEADER, TITLE, COMPND` | Which PDB header record tags are echoed to the log (default HEADER, TITLE, COMPND). |
| `pdb_formal_charges` | `1` | Read/write formal charges from PDB columns. |
| `pdb_hetatm_guess_valences` | `1` | Guess bond valences for HETATM residues on load. |
| `pdb_hetatm_sort` | `0` | Sorting mode applied to HETATM records. |
| `pdb_honor_model_number` | `0` | Honour MODEL numbers as explicit state indices. |
| `pdb_ignore_conect` | `0` | Ignore CONECT records when reading connectivity. |
| `pdb_insertions_go_first` | `0` | Place insertion-code residues before the base residue. |
| `pdb_insure_orthogonal` | `1` | Force the crystal cell to be orthogonalised. |
| `pdb_literal_names` | `0` | Keep atom names verbatim instead of PDB-standard reformatting. |
| `pdb_no_end_record` | `0` | Omit the END record when writing PDB files. |
| `pdb_reformat_names_mode` | `0` | Atom-name reformatting mode on load (0..4). |
| `pdb_retain_ids` | `0` | Retain original PDB serial IDs. |
| `pdb_standard_order` | `1` | Reorder atoms into standard residue order. |
| `pdb_truncate_residue_name` | `0` | Truncate residue names to 3 characters. |
| `pdb_unbond_cations` | `1` | Remove spurious bonds to metal cations on load. |
| `pdb_use_ter_records` | `1` | Emit/honour TER records to break polymer chains. |
| `pqr_no_chain_id` | `1` | Omit chain IDs when writing PQR files. |

## Picking {#picking}

| Setting | Default | Controls |
| --- | --- | --- |
| `pick32bit` | `1` | Use 32-bit colour-index picking buffers for large scenes. |
| `pick_labels` | `1` | Allow labels to be picked/selected. |
| `pick_shading` | `0` | Apply shading during the picking pass. |
| `pick_surface` | `0` | Make surfaces pickable. |
| `pickable` | `1` | Global toggle for whether objects can be picked. |

## Image & gamma output {#image}

| Setting | Default | Controls |
| --- | --- | --- |
| `png_file_gamma` | `1.0` | Gamma applied when writing PNG files. |
| `png_screen_gamma` | `2.4` | Gamma assumed for on-screen display when producing PNGs. |

## Colour space & ramps {#coloring}

| Setting | Default | Controls |
| --- | --- | --- |
| `pymol_space_max_blue` | `0.90` | Max blue component in the "pymol" named colour space. |
| `pymol_space_max_green` | `0.75` | Max green component in the "pymol" colour space. |
| `pymol_space_max_red` | `0.90` | Max red component in the "pymol" colour space. |
| `pymol_space_min_factor` | `0.15` | Minimum floor factor for the "pymol" colour space. |
| `ramp_blend_nearby_colors` | `0` | Blend adjacent ramp colours for smoother gradients. |

## Presentation & session export {#presentation}

| Setting | Default | Controls |
| --- | --- | --- |
| `presentation` | `0` | Enter presentation mode (hides GUI chrome). |
| `presentation_auto_quit` | `1` | Auto-quit at the end of a presentation. |
| `presentation_auto_start` | `1` | Auto-start the presentation on load. |
| `presentation_mode` | `1` | Presentation playback mode. |
| `pse_binary_dump` | `0` | Write PSE sessions using the fast binary dump format. |
| `pse_export_version` | `0.` | Target PSE file-format version on export (0 = current). |

## Ray tracer {#ray}

The ray tracer settings dominate this batch. `ray_shadow`, `ray_trace_mode` (cartoon outlines), `ray_opaque_background`, `ray_interior_*` (cut-away surface look) and the `ray_transparency_*` group are the ones most often touched. Values of `-1` defer to the matching global (`opaque_background`, `orthoscopic`, `fog`, `fog_start`).

| Setting | Default | Controls |
| --- | --- | --- |
| `ray_blend_blue` | `0.14` | Blue weight when ray_blend_colors mixes toward background. |
| `ray_blend_colors` | `0` | Blend ray colours toward the fog/background tint. |
| `ray_blend_green` | `0.25` | Green weight for ray colour blending. |
| `ray_blend_red` | `0.17` | Red weight for ray colour blending. |
| `ray_clip_shadows` | `0` | Clip shadows against the near/far planes. |
| `ray_color_ramps` | `0` | Let ray tracing honour colour ramps. |
| `ray_default_renderer` | `0` | Selects the default ray back-end (0 = built-in). |
| `ray_direct_shade` | `0.0` | Amount of direct (non-shadowed) shading added. |
| `ray_hint_camera` | `2.15` | Camera-distance hint constant for the ray tracer. |
| `ray_hint_shadow` | `0.65` | Shadow-distance hint constant for the ray tracer. |
| `ray_improve_shadows` | `0.1` | Refine/soften shadow edges during ray tracing. |
| `ray_interior_color` | `-1` | Colour used for interior (cut-away) surfaces (-1 = match object). |
| `ray_interior_mode` | `0` | How interior surfaces are shaded (0 = default). |
| `ray_interior_reflect` | `0.4` | Reflectivity of interior surfaces. |
| `ray_interior_shadows` | `0` | Cast shadows onto interior surfaces. |
| `ray_interior_texture` | `-1` | Texture index applied to interior surfaces (-1 = none). |
| `ray_label_connector_flat` | `1` | Draw label connector lines flat when ray tracing. |
| `ray_label_specular` | `1.0` | Specular strength on ray-traced label connectors. |
| `ray_legacy_lighting` | `0.0` | Blend toward pre-1.8 legacy lighting model (0..1). |
| `ray_max_passes` | `25` | Maximum antialiasing/refinement passes. |
| `ray_opaque_background` | `-1` | Force an opaque background in ray output (-1 = follow opaque_background). |
| `ray_orthoscopic` | `-1` | Ray-trace with orthographic projection (-1 = follow orthoscopic). |
| `ray_oversample_cutoff` | `120` | Pixel-neighbourhood cutoff for oversampling. |
| `ray_pixel_scale` | `1.30` | Scale factor applied to raster oversampling detail. |
| `ray_scatter` | `0.0` | Adds diffuse light scatter/ambient occlusion term. |
| `ray_shadow` | `1` | Master toggle for cast shadows in ray tracing. |
| `ray_shadow_decay_factor` | `0.0` | Distance decay factor for shadow darkness (0 = no decay). |
| `ray_shadow_decay_range` | `1.8` | Range over which shadow decay is applied. |
| `ray_shadow_fudge` | `0.001` | Small offset to avoid shadow self-intersection artefacts. |
| `ray_spec_local` | `0` | Use local (per-light position) specular highlights. |
| `ray_texture` | `0` | Surface texture pattern index (0 = none). |
| `ray_texture_settings` | `[0.1, 5.0, 1.0]` | Three texture tuning parameters for ray_texture. |
| `ray_trace_color` | `-6` | Outline colour used by ray_trace_mode (-6 = default). |
| `ray_trace_depth_factor` | `0.1` | Depth-cue weighting for outline (trace) rendering. |
| `ray_trace_disco_factor` | `0.05` | Discontinuity sensitivity for outline detection. |
| `ray_trace_fog` | `-1.0` | Fog amount in ray output (-1 = follow depth_cue/fog). |
| `ray_trace_fog_start` | `-1.0` | Where fog begins in ray output (-1 = follow fog_start). |
| `ray_trace_frames` | `0` | Ray-trace every movie frame during playback/export. |
| `ray_trace_gain` | `0.12` | Gain applied to outline (edge) darkening. |
| `ray_trace_mode` | `0` | Cartoon/outline ray mode (0 off, 1..3 add outlines). |
| `ray_trace_persist_cutoff` | `0.10` | Persistence cutoff for outline edges. |
| `ray_trace_slope_factor` | `0.6` | Slope weighting for outline edge detection. |
| `ray_trace_trans_cutoff` | `0.05` | Transparency cutoff below which outlines are drawn. |
| `ray_transparency_contrast` | `1.0` | Contrast of transparent-surface shading. |
| `ray_transparency_oblique` | `0.0` | Extra opacity at oblique (grazing) transparency angles. |
| `ray_transparency_oblique_power` | `4.0` | Exponent controlling the oblique transparency falloff. |
| `ray_transparency_shadows` | `1` | Let transparent surfaces cast shadows. |
| `ray_transparency_spec_cut` | `0.9` | Specular cutoff on transparent surfaces. |
| `ray_transparency_specular` | `0.6` | Specular intensity on transparent surfaces. |
| `ray_triangle_fudge` | `0.0000001` | Tiny geometric epsilon for triangle intersection. |
| `ray_volume` | `0` | Enable volumetric ray rendering path. |

## Reflection & shading {#lighting}

| Setting | Default | Controls |
| --- | --- | --- |
| `power` | `1.0` | Overall lighting power/exponent for ray shading. |
| `reflect` | `0.45` | Diffuse reflection intensity of the primary light. |
| `reflect_power` | `1.0` | Exponent (falloff sharpness) of diffuse reflection. |

## Ribbon representation {#ribbon}

Ribbon is the lightweight backbone trace (distinct from cartoon). Width/radius, spline sampling and the cylinder/shader rendering paths are the notable knobs.

| Setting | Default | Controls |
| --- | --- | --- |
| `ribbon_as_cylinders` | `0` | Draw ribbon traces as cylinders instead of lines. |
| `ribbon_color` | `-1` | Ribbon colour (-1 = inherit from atom). |
| `ribbon_nucleic_acid_mode` | `0` | Nucleic-acid ribbon path mode. |
| `ribbon_power` | `2.0` | Spline tension/power along the ribbon. |
| `ribbon_power_b` | `0.5` | Secondary spline tension parameter. |
| `ribbon_radius` | `0.0` | Ribbon tube radius (0 = auto from width). |
| `ribbon_sampling` | `1` | Spline samples per residue segment. |
| `ribbon_side_chain_helper` | `0` | Hide backbone lines where ribbon is shown to reduce clutter. |
| `ribbon_throw` | `1.35` | Spline overshoot/throw distance. |
| `ribbon_trace_atoms` | `0` | Trace through every atom rather than CA/backbone only. |
| `ribbon_transparency` | `0.0` | Ribbon transparency (0 opaque .. 1 invisible). |
| `ribbon_use_shader` | `1` | Render ribbons through the GPU shader path. |
| `ribbon_width` | `3.0` | Ribbon line width in pixels. |

## Roving detail {#roving}

Roving detail auto-shows representations only within a radius of a moving origin, for interactive exploration of large structures. Each `roving_<rep>` value is that radius (0 or negative generally disables that rep).

| Setting | Default | Controls |
| --- | --- | --- |
| `roving_byres` | `1` | Expand roving selection to whole residues. |
| `roving_cartoon` | `0.0` | Roving-region cartoon radius (0 = off). |
| `roving_delay` | `0.2` | Idle delay before roving update fires. |
| `roving_detail` | `0` | Enable roving detail (auto reps near the origin). |
| `roving_isomesh` | `8.0` | Roving isomesh display radius. |
| `roving_isosurface` | `0.0` | Roving isosurface display radius (0 = off). |
| `roving_labels` | `0.0` | Roving label display radius (0 = off). |
| `roving_lines` | `10.0` | Roving lines display radius. |
| `roving_map1_level` | `1.0` | Contour level for roving map slot 1. |
| `roving_map1_name` | — | Map object name for roving slot 1. |
| `roving_map2_level` | `2.0` | Contour level for roving map slot 2. |
| `roving_map2_name` | — | Map object name for roving slot 2. |
| `roving_map3_level` | `3.0` | Contour level for roving map slot 3. |
| `roving_map3_name` | — | Map object name for roving slot 3. |
| `roving_nb_spheres` | `8.0` | Roving nonbonded-sphere display radius. |
| `roving_nonbonded` | `0.0` | Roving nonbonded display radius (0 = off). |
| `roving_origin` | `1` | Recenter the roving origin on camera moves. |
| `roving_origin_z` | `1` | Include Z when computing the roving origin. |
| `roving_origin_z_cushion` | `3.0` | Z cushion distance around the roving origin. |
| `roving_polar_contacts` | `7.0` | Roving polar-contact display radius. |
| `roving_polar_cutoff` | `3.31` | Distance cutoff for roving polar contacts. |
| `roving_ribbon` | `-7.0` | Roving ribbon display radius (negative = off/behind). |
| `roving_selection` | `all` | Named selection roving reps are applied within. |
| `roving_spheres` | `0.0` | Roving sphere display radius (0 = off). |
| `roving_sticks` | `6.0` | Roving sticks display radius. |

## Rocking, rendering & system misc {#rock}

| Setting | Default | Controls |
| --- | --- | --- |
| `preserve_chempy_ids` | `0` | Keep ChemPy model atom IDs on load instead of renumbering. |
| `rank_assisted_sorts` | `1` | Use rank-assisted algorithm when sorting atoms. |
| `render_as_cylinders` | `1` | Render bonds/edges as shader cylinders where supported. |
| `robust_logs` | `0` | Emit more verbose/robust command logging. |
| `rock` | `0` | Enable continuous rocking of the camera. |
| `rock_delay` | `30.0` | Rock cycle period/delay in units of time. |

## Scenes {#scene}

| Setting | Default | Controls |
| --- | --- | --- |
| `scene_animation` | `-1` | Animate transitions between scenes (-1 = follow animation). |
| `scene_animation_duration` | `2.25` | Duration in seconds of scene-to-scene animation. |
| `scene_buttons` | `1` | Show the on-screen scene buttons bar. |
| `scene_current_name` | — | Name of the currently active scene. |
| `scene_frame_mode` | `-1` | How scenes bind to movie frames (-1 = auto). |
| `scene_loop` | `0` | Loop back to the first scene after the last. |
| `scene_restart_movie_delay` | `1` | Restart the movie after a scene delay. |
| `scenes_changed` | `1` | Internal dirty flag: scene list has changed. |

## Sculpting force field {#sculpt}

These weight/scale the terms of the real-time sculpting force field, gated overall by `sculpting` and `sculpt_field_mask` (a bitmask of which terms are live). Each geometric term (bond, angle, torsion, planarity, pyramid, triangle, VDW) has a `*_weight`, and several have min/max/scale distance bounds.

| Setting | Default | Controls |
| --- | --- | --- |
| `sculpt_angl_weight` | `1.0` | Force weight for bond-angle restraints. |
| `sculpt_auto_center` | `0` | Auto-recenter the model during sculpting. |
| `sculpt_avd_excl` | `7` | Anti-van-der-Waals-distance exclusion count. |
| `sculpt_avd_gap` | `-1.0` | AVD gap parameter (-1 = auto). |
| `sculpt_avd_range` | `-1.0` | AVD interaction range (-1 = auto). |
| `sculpt_avd_weight` | `4.0` | Force weight for the AVD term. |
| `sculpt_bond_weight` | `2.25` | Force weight for bond-length restraints. |
| `sculpt_field_mask` | `0x1FF` | Bitmask selecting which sculpt force terms are active (0x1FF = all). |
| `sculpt_hb_overlap` | `1.0` | Hydrogen-bond overlap force weight. |
| `sculpt_hb_overlap_base` | `0.35` | Baseline H-bond overlap distance. |
| `sculpt_line_weight` | `1.0` | Force weight for planar/line restraints. |
| `sculpt_max_max` | `12.0` | Upper distance bound for the max (VDW cap) term. |
| `sculpt_max_min` | `4.0` | Lower distance bound for the max term. |
| `sculpt_max_scale` | `1.025` | Distance scale for the max term. |
| `sculpt_max_weight` | `0.75` | Force weight for the max (repulsive cap) term. |
| `sculpt_memory` | `1` | Retain restraint memory across sculpt cycles. |
| `sculpt_min_max` | `12.0` | Upper distance bound for the min (attractive) term. |
| `sculpt_min_min` | `4.0` | Lower distance bound for the min term. |
| `sculpt_min_scale` | `0.975` | Distance scale for the min term. |
| `sculpt_min_weight` | `0.75` | Force weight for the min term. |
| `sculpt_nb_interval` | `17` | Cycle interval for rebuilding the nonbonded list. |
| `sculpt_plan_weight` | `1.0` | Force weight for planarity restraints. |
| `sculpt_pyra_inv_weight` | `10.0` | Force weight against chiral (pyramid) inversion. |
| `sculpt_pyra_weight` | `1.0` | Force weight for pyramidal-geometry restraints. |
| `sculpt_tors_tolerance` | `0.05` | Angular tolerance before torsion restraints engage. |
| `sculpt_tors_weight` | `0.05` | Force weight for torsion restraints. |
| `sculpt_tri_max` | `18` | Upper bound for the triangle (1-3) term. |
| `sculpt_tri_min` | `2` | Lower bound for the triangle term. |
| `sculpt_tri_mode` | `0` | Mode selector for the triangle term. |
| `sculpt_tri_scale` | `1.025` | Distance scale for the triangle term. |
| `sculpt_tri_weight` | `1.0` | Force weight for the triangle (1-3 distance) term. |
| `sculpt_vdw_scale` | `0.97` | VDW radius scale for 1-4+ nonbonded pairs. |
| `sculpt_vdw_scale14` | `0.90` | VDW radius scale for 1-4 (torsion-adjacent) pairs. |
| `sculpt_vdw_vis_max` | `0.3` | Upper strain value for VDW strain visualisation. |
| `sculpt_vdw_vis_mid` | `0.1` | Midpoint strain value for VDW strain visualisation. |
| `sculpt_vdw_vis_min` | `-0.1` | Lower strain value for VDW strain visualisation. |
| `sculpt_vdw_vis_mode` | `0` | VDW strain visualisation mode (0 = off). |
| `sculpt_vdw_weight` | `1.0` | Force weight for the VDW term (1-4+ pairs). |
| `sculpt_vdw_weight14` | `0.2` | Force weight for the 1-4 VDW term. |
| `sculpting` | `0` | Master toggle enabling real-time sculpting. |
| `sculpting_cycles` | `10` | Minimisation cycles run per sculpt refresh. |

## Measurement cutoffs {#measurement}

| Setting | Default | Controls |
| --- | --- | --- |
| `polar_neighbor_cutoff` | `3.5` | Distance cutoff for polar-neighbour detection. |
| `salt_bridge_distance` | `5.0` | Max distance defining a salt bridge. |

## Other molecular file I/O {#fileio}

| Setting | Default | Controls |
| --- | --- | --- |
| `retain_order` | `0` | Preserve original atom ordering on load rather than re-sorting. |
| `sdf_write_zero_order_bonds` | `0` | Encode zero-order bonds when writing SDF/MOL. |

## Source

Defaults and types: `packages/engine/layer1/SettingInfo.h`. Settings system prose: `docs/settings-colors.md`. Names enumerated in `docs/api-reference/settings.mdx` (entries 401-600). Parity: settings storage/introspection is implemented via the settings bridge; per-setting rendering consumption in `packages/engine-ts/src` is confirmed only for `orthoscopic`, `ribbon_sampling`, `ribbon_width`, `rock`, `scene_animation_duration`, `pdb_literal_names`, `pdb_reformat_names_mode`.
