/**
 * The menu-bar data model.
 *
 * Ground truth is `PyMOLDesktopGUI.get_menudata` in `packages/engine/modules/pymol/_gui.py:55-900`
 * (NOT `packages/engine/modules/pymol/menu.py`, which drives the in-viewport right-click popups --
 * see docs/qt-main-window.md §0). The item grammar below mirrors the tuple
 * grammar consumed by `_addmenu` in `packages/engine/modules/pmg_qt/pymol_qt_gui.py:295-344`:
 *
 *   ('separator',)                              -> { kind: 'separator' }
 *   ('menu', label, [items])                    -> { kind: 'menu' }
 *   ('command', label, callable | commandString) -> { kind: 'command' }
 *   ('check', label, setting[, on, off])        -> { kind: 'check' }
 *   ('radio', label, setting, value)            -> { kind: 'radio' }
 *   ('open_recent_menu',)                       -> { kind: 'recent' }
 *
 * TODO(gen-menus): this table is a hand-written, deliberately truncated excerpt so the
 * shell has all eleven top-level menus with real labels. The full tree (hundreds of
 * leaves, including every `radio` group) must come from the `tools/gen-menus`
 * extractor that runs `get_menudata()` inside a real PyMOL and emits JSON. Do not grow
 * this file by hand.
 */

export type MenuItem =
  | { kind: 'separator' }
  | { kind: 'menu'; label: string; items: MenuItem[] }
  /** `cmd` is a raw PyMOL command line -> sent as `{ t: 'do', cmd }`. */
  | { kind: 'command'; label: string; cmd?: string; dialog?: string }
  | { kind: 'check'; label: string; setting: string; on?: number; off?: number }
  | { kind: 'radio'; label: string; setting: string; value: number | string }
  | { kind: 'recent' };

export interface TopLevelMenu {
  label: string;
  items: MenuItem[];
}

const sep: MenuItem = { kind: 'separator' };

export const MENU_BAR: TopLevelMenu[] = [
  {
    label: 'File',
    items: [
      {
        kind: 'menu',
        label: 'New PyMOL Window',
        items: [
          { kind: 'command', label: 'Default', dialog: 'new-window' },
          { kind: 'command', label: 'Ignore .pymolrc and plugins (-k)', dialog: 'new-window-k' },
        ],
      },
      sep,
      { kind: 'command', label: 'Open...', dialog: 'file-open' },
      { kind: 'recent' },
      { kind: 'command', label: 'Get PDB...', dialog: 'fetch-pdb' },
      sep,
      { kind: 'command', label: 'Save Session', dialog: 'session-save' },
      { kind: 'command', label: 'Save Session As...', dialog: 'session-save-as' },
      sep,
      { kind: 'command', label: 'Export Molecule...', dialog: 'export-molecule' },
      { kind: 'command', label: 'Export Map...', dialog: 'export-map' },
      { kind: 'command', label: 'Export Alignment...', dialog: 'export-alignment' },
      {
        kind: 'menu',
        label: 'Export Image As',
        items: [
          { kind: 'command', label: 'PNG...', dialog: 'export-png' },
          sep,
          { kind: 'command', label: 'VRML 2...', dialog: 'export-wrl' },
          { kind: 'command', label: 'COLLADA...', dialog: 'export-dae' },
          { kind: 'command', label: 'GLTF...', dialog: 'export-gltf' },
          { kind: 'command', label: 'POV-Ray...', dialog: 'export-pov' },
          { kind: 'command', label: 'STL...', dialog: 'export-stl' },
        ],
      },
      {
        kind: 'menu',
        label: 'Export Movie As',
        items: [
          { kind: 'command', label: 'MPEG...', dialog: 'export-mpeg' },
          { kind: 'command', label: 'Quicktime...', dialog: 'export-mov' },
          sep,
          { kind: 'command', label: 'PNG Images...', dialog: 'export-mpng' },
        ],
      },
      sep,
      {
        kind: 'menu',
        label: 'Log File',
        items: [
          { kind: 'command', label: 'Open...', dialog: 'log-open' },
          { kind: 'command', label: 'Resume...', dialog: 'log-resume' },
          { kind: 'command', label: 'Append...', dialog: 'log-append' },
          { kind: 'command', label: 'Close', cmd: 'log_close' },
        ],
      },
      { kind: 'command', label: 'Run Script...', dialog: 'run-script' },
      {
        kind: 'menu',
        label: 'Working Directory',
        items: [
          { kind: 'command', label: 'Change...', dialog: 'cd' },
          { kind: 'command', label: 'File Browser', dialog: 'file-browser' },
        ],
      },
      sep,
      { kind: 'command', label: 'Edit pymolrc', dialog: 'edit-pymolrc' },
      sep,
      {
        kind: 'menu',
        label: 'Reinitialize',
        items: [
          { kind: 'command', label: 'Everything', cmd: 'reinitialize' },
          { kind: 'command', label: 'Original Settings', cmd: 'reinitialize original_settings' },
          { kind: 'command', label: 'Stored Settings', cmd: 'reinitialize settings' },
          sep,
          {
            kind: 'command',
            label: 'Store Current Settings',
            cmd: 'reinitialize store_defaults',
          },
        ],
      },
      { kind: 'command', label: 'Quit', dialog: 'quit' },
    ],
  },
  {
    label: 'Edit',
    items: [
      { kind: 'command', label: 'Undo [Ctrl-Z]', cmd: 'undo' },
      { kind: 'command', label: 'Redo [Ctrl-Y]', cmd: 'redo' },
    ],
  },
  {
    label: 'Build',
    items: [
      {
        kind: 'menu',
        label: 'Fragment',
        items: [
          {
            kind: 'command',
            label: 'Acetylene [Alt-J]',
            cmd: "editor.attach_fragment('pk1','acetylene',2,0)",
          },
          {
            kind: 'command',
            label: 'Amide N->C [Alt-1]',
            cmd: "editor.attach_fragment('pk1','formamide',3,1)",
          },
          { kind: 'command', label: 'Carbon [Ctrl-Shift-C]', cmd: 'replace C,4,4' },
          { kind: 'command', label: 'Nitrogen [Ctrl-Shift-N]', cmd: 'replace N,4,3' },
          { kind: 'command', label: 'Oxygen [Ctrl-Shift-O]', cmd: 'replace O,4,2' },
        ],
      },
      {
        kind: 'menu',
        label: 'Residue',
        items: [
          {
            kind: 'command',
            label: 'Alanine [Alt-A]',
            cmd: "editor.attach_amino_acid('pk1','ala')",
          },
          {
            kind: 'command',
            label: 'Glycine [Alt-G]',
            cmd: "editor.attach_amino_acid('pk1','gly')",
          },
          {
            kind: 'command',
            label: 'Serine [Alt-S]',
            cmd: "editor.attach_amino_acid('pk1','ser')",
          },
          sep,
          { kind: 'radio', label: 'Helix', setting: 'secondary_structure', value: 1 },
          {
            kind: 'radio',
            label: 'Antiparallel Beta Sheet',
            setting: 'secondary_structure',
            value: 2,
          },
          { kind: 'radio', label: 'Parallel Beta Sheet', setting: 'secondary_structure', value: 3 },
        ],
      },
      {
        kind: 'menu',
        label: 'Sculpting',
        items: [
          { kind: 'check', label: 'Auto-Sculpting', setting: 'auto_sculpt' },
          { kind: 'check', label: 'Sculpting', setting: 'sculpting' },
          sep,
          { kind: 'command', label: 'Activate', cmd: 'sculpt_activate all' },
          { kind: 'command', label: 'Deactivate', cmd: 'sculpt_deactivate all' },
          { kind: 'command', label: 'Clear Memory', cmd: 'sculpt_purge' },
        ],
      },
      sep,
      { kind: 'command', label: 'Cycle Bond Valence [Ctrl-Shift-W]', cmd: 'cycle_valence' },
      { kind: 'command', label: 'Fill Hydrogens', cmd: 'h_fill' },
      { kind: 'command', label: 'Invert [Ctrl-Shift-E]', cmd: 'invert' },
    ],
  },
  {
    label: 'Movie',
    items: [
      {
        kind: 'menu',
        label: 'Append',
        items: [
          { kind: 'command', label: '1 second', cmd: 'movie.add_blank(1)' },
          { kind: 'command', label: '2 second', cmd: 'movie.add_blank(2)' },
          { kind: 'command', label: '4 second', cmd: 'movie.add_blank(4)' },
          { kind: 'command', label: '8 second', cmd: 'movie.add_blank(8)' },
        ],
      },
      sep,
      {
        kind: 'menu',
        label: 'Program',
        items: [
          {
            kind: 'menu',
            label: 'Camera Loop',
            items: [
              {
                kind: 'menu',
                label: 'Nutate',
                items: [
                  { kind: 'command', label: '15 deg. over 4 sec.', cmd: 'movie.add_nutate(4,15)' },
                  { kind: 'command', label: '30 deg. over 8 sec.', cmd: 'movie.add_nutate(8,30)' },
                ],
              },
              {
                kind: 'menu',
                label: 'X-Rock',
                items: [
                  {
                    kind: 'command',
                    label: '30 deg. over 2 sec.',
                    cmd: "movie.add_rock(2,30,axis='x')",
                  },
                ],
              },
            ],
          },
        ],
      },
      sep,
      { kind: 'command', label: 'Reset', cmd: 'mset' },
      sep,
      { kind: 'check', label: 'Auto Interpolate', setting: 'movie_auto_interpolate' },
      { kind: 'check', label: 'Show Panel', setting: 'movie_panel' },
      { kind: 'check', label: 'Loop', setting: 'movie_loop' },
      sep,
      { kind: 'command', label: 'Reset Storyboard', cmd: 'mview reset' },
    ],
  },
  {
    label: 'Display',
    items: [
      { kind: 'check', label: 'Sequence', setting: 'seq_view', on: 1 },
      {
        kind: 'menu',
        label: 'Sequence Mode',
        items: [
          { kind: 'radio', label: 'Residue Codes', setting: 'seq_view_format', value: 0 },
          { kind: 'radio', label: 'Residue Names', setting: 'seq_view_format', value: 1 },
          { kind: 'radio', label: 'Chain Identifiers', setting: 'seq_view_format', value: 3 },
          { kind: 'radio', label: 'Atom Names', setting: 'seq_view_format', value: 2 },
          { kind: 'radio', label: 'States', setting: 'seq_view_format', value: 4 },
        ],
      },
      sep,
      { kind: 'check', label: 'Internal GUI', setting: 'internal_gui' },
      { kind: 'check', label: 'Internal Prompt', setting: 'internal_prompt' },
      { kind: 'check', label: 'Overlay', setting: 'overlay' },
      sep,
      { kind: 'command', label: 'Full Screen [Alt-F]', cmd: 'full_screen' },
      {
        kind: 'menu',
        label: 'External GUI',
        items: [
          { kind: 'command', label: 'Toggle dockable [Ctrl-E]', dialog: 'ext-gui-dockable' },
          { kind: 'command', label: 'Visible', dialog: 'ext-gui-visible' },
        ],
      },
      sep,
      {
        kind: 'menu',
        label: 'Background',
        items: [
          { kind: 'command', label: 'White', cmd: 'bg_color white' },
          { kind: 'command', label: 'Light Grey', cmd: 'bg_color grey80' },
          { kind: 'command', label: 'Black', cmd: 'bg_color black' },
          sep,
          { kind: 'check', label: 'Opaque', setting: 'opaque_background' },
        ],
      },
    ],
  },
  {
    label: 'Setting',
    items: [
      { kind: 'command', label: 'Edit All...', dialog: 'settings-edit-all' },
      { kind: 'command', label: 'Keyboard Shortcuts...', dialog: 'shortcut-menu' },
      { kind: 'command', label: 'Colors...', dialog: 'edit-colors' },
      sep,
      {
        kind: 'menu',
        label: 'Label',
        items: [
          {
            kind: 'menu',
            label: 'Size',
            items: [
              { kind: 'radio', label: '10 Point', setting: 'label_size', value: 10 },
              { kind: 'radio', label: '14 Point', setting: 'label_size', value: 14 },
              { kind: 'radio', label: '18 Point', setting: 'label_size', value: 18 },
            ],
          },
        ],
      },
      {
        kind: 'menu',
        label: 'Cartoon',
        items: [{ kind: 'check', label: 'Round Helices', setting: 'cartoon_round_helices' }],
      },
      {
        kind: 'menu',
        label: 'Transparency',
        items: [
          { kind: 'radio', label: 'Off', setting: 'transparency', value: 0 },
          { kind: 'radio', label: '20%', setting: 'transparency', value: 0.2 },
          { kind: 'radio', label: '50%', setting: 'transparency', value: 0.5 },
        ],
      },
      sep,
      { kind: 'check', label: 'Auto-Zoom on Load', setting: 'auto_zoom' },
      { kind: 'check', label: 'Show Valences', setting: 'valence' },
      { kind: 'check', label: 'Ray Trace Frames', setting: 'ray_trace_frames' },
    ],
  },
  {
    label: 'Scene',
    items: [
      { kind: 'command', label: 'Scenes...', dialog: 'scene-panel' },
      sep,
      { kind: 'command', label: 'Next [PgDn]', cmd: "scene '', next" },
      { kind: 'command', label: 'Previous [PgUp]', cmd: "scene '', previous" },
      sep,
      { kind: 'command', label: 'Append', cmd: 'scene new, store' },
      {
        kind: 'menu',
        label: 'Append...',
        items: [
          { kind: 'command', label: 'Camera', cmd: 'scene new, store, color=0, rep=0' },
          { kind: 'command', label: 'Color', cmd: 'scene new, store, view=0, rep=0' },
          { kind: 'command', label: 'Reps', cmd: 'scene new, store, view=0, color=0' },
          { kind: 'command', label: 'Reps + Color', cmd: 'scene new, store, view=0' },
        ],
      },
      { kind: 'command', label: 'Insert Before', cmd: "scene '', insert_before" },
      { kind: 'command', label: 'Insert After', cmd: "scene '', insert_after" },
      { kind: 'command', label: 'Update', cmd: 'scene auto, update' },
      sep,
      { kind: 'command', label: 'Delete', cmd: 'scene auto, clear' },
      sep,
      { kind: 'check', label: 'Buttons', setting: 'scene_buttons', on: 1 },
    ],
  },
  {
    label: 'Mouse',
    items: [
      {
        kind: 'menu',
        label: 'Selection Mode',
        items: [
          { kind: 'radio', label: 'Atoms', setting: 'mouse_selection_mode', value: 0 },
          { kind: 'radio', label: 'Residues', setting: 'mouse_selection_mode', value: 1 },
          { kind: 'radio', label: 'Chains', setting: 'mouse_selection_mode', value: 2 },
          { kind: 'radio', label: 'Segments', setting: 'mouse_selection_mode', value: 3 },
          { kind: 'radio', label: 'Objects', setting: 'mouse_selection_mode', value: 4 },
          { kind: 'radio', label: 'Molecules', setting: 'mouse_selection_mode', value: 5 },
          { kind: 'radio', label: 'C-alphas', setting: 'mouse_selection_mode', value: 6 },
        ],
      },
      sep,
      { kind: 'command', label: '3 Button Motions', cmd: 'config_mouse three_button_motions' },
      { kind: 'command', label: '3 Button Editing', cmd: 'config_mouse three_button_editing' },
      { kind: 'command', label: '3 Button Viewing', cmd: 'mouse three_button_viewing' },
      { kind: 'command', label: '3 Button Lights', cmd: 'mouse three_button_lights' },
      { kind: 'command', label: '3 Button All Modes', cmd: 'config_mouse three_button_all_modes' },
      { kind: 'command', label: '2 Button Editing', cmd: 'config_mouse two_button_editing' },
      { kind: 'command', label: '2 Button Viewing', cmd: 'config_mouse two_button' },
      { kind: 'command', label: '1 Button Viewing Mode', cmd: 'mouse one_button_viewing' },
      { kind: 'command', label: 'Emulate Maestro', cmd: 'mouse three_button_maestro' },
      sep,
      { kind: 'check', label: 'Virtual Trackball', setting: 'virtual_trackball' },
      { kind: 'check', label: 'Show Mouse Grid', setting: 'mouse_grid' },
      { kind: 'check', label: 'Roving Origin', setting: 'roving_origin' },
    ],
  },
  {
    label: 'Wizard',
    items: [
      { kind: 'command', label: 'Appearance', cmd: 'wizard appearance' },
      { kind: 'command', label: 'Measurement', cmd: 'wizard measurement' },
      {
        kind: 'menu',
        label: 'Mutagenesis',
        items: [
          { kind: 'command', label: 'Protein', cmd: 'wizard mutagenesis' },
          { kind: 'command', label: 'Nucleic Acids', cmd: 'wizard nucmutagenesis' },
        ],
      },
      { kind: 'command', label: 'Pair Fitting', cmd: 'wizard pair_fit' },
      sep,
      { kind: 'command', label: 'Density', cmd: 'wizard density' },
      { kind: 'command', label: 'Filter', cmd: 'wizard filter' },
      { kind: 'command', label: 'Sculpting', cmd: 'wizard sculpting' },
      sep,
      { kind: 'command', label: 'Label', cmd: 'wizard label' },
      { kind: 'command', label: 'Charge', cmd: 'wizard charge' },
      sep,
      {
        kind: 'menu',
        label: 'Demo',
        items: [
          { kind: 'command', label: 'Representations', cmd: 'wizard demo, reps' },
          { kind: 'command', label: 'Cartoon Ribbons', cmd: 'wizard demo, cartoon' },
          { kind: 'command', label: 'Ray Tracing', cmd: 'wizard demo, ray' },
          sep,
          { kind: 'command', label: 'End Demonstration', cmd: 'replace_wizard demo, finish' },
        ],
      },
    ],
  },
  {
    // `('menu', 'Plugin', [])` -- empty in _gui.py:866; populated at runtime by
    // pymol.plugins.initialize() via the mimic_pmg_tk menu-bar shim.
    label: 'Plugin',
    items: [
      { kind: 'command', label: 'Plugin Manager', dialog: 'plugin-manager' },
      { kind: 'command', label: 'Install Plugin...', dialog: 'plugin-install' },
      sep,
      { kind: 'command', label: 'APBS Electrostatics', dialog: 'apbs' },
    ],
  },
  {
    label: 'Help',
    items: [
      { kind: 'command', label: 'PyMOL Home Page', dialog: 'open-url:http://www.pymol.org' },
      {
        kind: 'command',
        label: 'PyMOL Community Wiki',
        dialog: 'open-url:http://www.pymolwiki.org',
      },
      sep,
      {
        kind: 'command',
        label: 'PyMOL Command Reference',
        dialog: 'open-url:http://pymol.org/pymol-command-ref.html',
      },
      sep,
      { kind: 'command', label: 'About PyMOL', dialog: 'about' },
    ],
  },
];
