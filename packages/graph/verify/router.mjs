// Route a manifest feature to a verification modality.
//
//   probeKind:
//     state  -> verifiable through STATE observables (count_atoms, get_view, get_*,
//               get_setting, get_color_*, get_model). Ground-truthable against the
//               no-GL oracle NOW. This is the bulk and the phase-1 focus.
//     visual -> only truly provable from PIXELS (ray/png/reps' appearance). Needs a
//               GL oracle; routed but deferred (worker marks blocked:needs-gl-oracle
//               if no state proxy exists). Reps still get a state proxy: rep-membership.
//     ui     -> only provable by driving the GUI (wizards, menus, mouse, dialogs).
//               Routed; deferred to a UI-driving pass.
//     na     -> not a runtime-verifiable feature (internal helpers, control-flow like
//               python/cd/ls/spawn, pure docs). Auto-skipped.
//
// `oracleable` = can we get ground truth from the current (no-GL) oracle.

const NA_NAMES = new Set([
  'python', 'python_help', 'cd', 'ls', 'pwd', 'system', 'spawn', 'sync', 'async_',
  'help', 'commands', 'api', 'abort', 'skip', 'embed', 'ready', 'interrupt', 'resume',
  'ipython_image', 'is_dict', 'is_error', 'is_list', 'is_ok', 'is_sequence', 'is_string',
  'is_tuple', 'is_gui_thread', 'safe_eval', 'safe_list_eval', 'safe_alpha_list_eval',
  'lock', 'unlock', 'lock_attempt', 'lock_without_glut', 'LockCM', 'SafeEvalNS', 'Shortcut',
  'block_flush', 'unblock_flush', 'mem', 'test', 'file_read', 'exp_path', 'filename_to_objectname',
]);

const STATE_CATEGORIES = new Set([
  'selecting', 'coloring', 'measurement', 'querying', 'editing-building',
  'fitting-alignment', 'sculpting-minimization', 'symmetry', 'objects-groups',
  'properties', 'viewing-camera', 'settings',
]);
const VISUAL_CATEGORIES = new Set(['rendering-export', 'representations-display', 'labeling', 'cgo']);
const UI_CATEGORIES = new Set(['ui-gui']);

export function route(feature) {
  const kind = feature.kind || 'feature';
  const cat = feature.category || 'misc';
  const name = feature.name || '';

  const sub = feature.subcategory || '';

  // Internal / non-runtime → skip.
  if (kind === 'feature' && cat === 'internal') return { probeKind: 'na', oracleable: false, reason: 'internal helper' };
  if (String(feature.parityStatus) === 'internal') return { probeKind: 'na', oracleable: false, reason: 'internal' };
  if (/^_/.test(name) || NA_NAMES.has(name)) return { probeKind: 'na', oracleable: false, reason: 'non-observable command' };

  // GUI features are provable only by driving the UI — regardless of `kind`.
  // This must precede the kind switch: a `selection`/`feature` entry in the
  // ui-gui category (e.g. selection-indicators) is a GUI cue, not a headless
  // state observable. Likewise a Qt/web "UI panel" feature (Volume Color Map
  // Editor) is verified in the web app, never against the no-GL/headless oracle.
  if (UI_CATEGORIES.has(cat)) return { probeKind: 'ui', oracleable: false, reason: 'GUI feature (ui-gui)' };
  if (kind === 'feature' && /\bUI panel\b/i.test(sub))
    return { probeKind: 'ui', oracleable: false, reason: 'GUI panel (web/Qt), not oracle state' };

  switch (kind) {
    case 'color':
      return { probeKind: 'state', oracleable: true, reason: 'get_color_index/tuple roundtrip' };
    case 'selection':
      return { probeKind: 'state', oracleable: true, reason: 'count_atoms(selector)' };
    case 'setting':
      return { probeKind: 'state', oracleable: true, reason: 'set/get roundtrip' };
    case 'representation':
      // Verifiable-now via rep membership (count_atoms("rep X")); pixel-accuracy deferred.
      return { probeKind: 'visual', oracleable: true, reason: 'rep-membership state proxy; pixels deferred' };
    case 'preset':
      return { probeKind: 'visual', oracleable: true, reason: 'rep/colour state after preset; pixels deferred' };
    case 'wizard':
      return { probeKind: 'ui', oracleable: false, reason: 'interactive wizard' };
    case 'command':
    default: {
      if (UI_CATEGORIES.has(cat)) return { probeKind: 'ui', oracleable: false, reason: 'GUI command' };
      if (VISUAL_CATEGORIES.has(cat)) {
        // Some "rendering-export" commands are actually string exporters (get_pdbstr…) => state.
        if (/^get_.*str$|^get_(model|coords|names|type|title|chains|extent)$/.test(name))
          return { probeKind: 'state', oracleable: true, reason: 'string/data exporter' };
        return { probeKind: 'visual', oracleable: ORACLE_GL(), reason: 'pixel output' };
      }
      if (cat === 'control-flow-system') return { probeKind: 'na', oracleable: false, reason: 'control-flow' };
      if (cat === 'file-io') return { probeKind: 'state', oracleable: true, reason: 'load/roundtrip counts' };
      if (cat === 'movies-scenes-states') return { probeKind: 'state', oracleable: true, reason: 'frame/state counts' };
      if (cat === 'maps-volumes') return { probeKind: 'state', oracleable: true, reason: 'map objects/get_names' };
      if (STATE_CATEGORIES.has(cat)) return { probeKind: 'state', oracleable: true, reason: `state observable (${cat})` };
      return { probeKind: 'state', oracleable: true, reason: 'default state probe' };
    }
  }
}

function ORACLE_GL() {
  return process.env.TENMOL_ORACLE_GL === '1';
}
