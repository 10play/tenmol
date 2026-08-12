/**
 * A per-story session that drives the {@link PropertiesPanel} the way a live
 * inspection session would, instead of the empty four-level skeleton the bare
 * stub draws.
 *
 * WHY THE PANEL IS HOLLOW ON THE STUB. The inspector bootstraps on mount by
 * reading `get_object_list` / `get_state` / a pk1 probe, then — once it has a
 * model — reads the whole tree: `count_atoms`, `get_object_ttt`,
 * `get_object_settings`, `get_title`, `get_object_matrix`, `get_model` for the
 * picked atom and the bridge helper `cmd.tenmol_props.atom_extras`. The global
 * `withSession` decorator answers every `call()` with `null`, so the object
 * combo reads "(no objects)", every group collapses to an em-dash, and the
 * inspector is a labelled skeleton with nothing in it.
 *
 * WHAT THIS SUPPLIES. One picked atom in ubiquitin (`1ubq`, chain A, LYS 6, the
 * Cα) with pk1 sitting on it, plus a couple of other loaded objects. Every
 * branch then fills: the object's TTT matrix, three object-level settings
 * (resolved through the zipped setting name/index lists to `sphere_scale`,
 * `stick_radius`, `surface_quality`), the state title + matrix and an
 * object-state setting (`cartoon_transparency`), the atom's eleven identifiers,
 * all nineteen built-ins (the seven chempy-less ones arriving from the helper),
 * two custom `p.*` properties, and the atom-state coordinates. The follow poll's
 * `index('?pk1')` keeps answering the same pick so the panel stays put.
 *
 * Not a `*.stories.tsx` file, so Storybook does not index it as a story.
 */

import type { Decorator } from '@storybook/react-vite';
import { SessionContext, type Session } from '@web/app';

import { mockSession } from '../../.storybook/decorators';

/** The loaded objects; the inspector opens on `1ubq`, where pk1 sits. */
const OBJECTS = ['1ubq', 'benzene', 'ao_ligand'];

/** The picked object, atom index and state the whole tree is read for. */
const MODEL = '1ubq';
const PK1_INDEX = 42;

/**
 * The zipped setting name / index lists (`setting.get_name_list` +
 * `setting.get_index_list`) — the panel resolves a numeric settings row through
 * these into a human name. Only the handful the fixtures reference need be real.
 */
const SETTING_NAMES = ['sphere_scale', 'cartoon_transparency', 'stick_radius', 'surface_quality'];
const SETTING_INDICES = [52, 187, 65, 220];

/** One ubiquitin Cα as `cmd.get_model` returns it (chempy `Atom` fields). */
const ATOM = {
  index: PK1_INDEX,
  id: 42,
  rank: 41,
  name: 'CA',
  symbol: 'C',
  elem: 'C',
  resn: 'LYS',
  resi: '6',
  chain: 'A',
  segi: '',
  alt: '',
  ss: 'H',
  b: 18.44,
  q: 1,
  vdw: 1.7,
  elec_radius: 0,
  partial_charge: 0,
  formal_charge: 0,
  numeric_type: -1,
  text_type: '',
  coord: [26.353, 24.502, 5.263],
  flags: 0,
  hetatm: 0,
};

/** The bridge helper's reply: the seven chempy-less built-ins plus custom `p.*`. */
const ATOM_EXTRAS = {
  ok: true,
  found: true,
  builtins: { reps: 1, label: '', cartoon: 0, protons: 6, geom: 4, valence: 4, color: 5 },
  properties: { source: '1UBQ', quality: 'refined' },
};

/** A 4×4 TTT matrix with a small translation, so the row is not the identity. */
const TTT = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 12.5, -4.2, 0, 1];
/** The object-state matrix — the identity, i.e. no per-state transform yet. */
const STATE_MATRIX = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

/** `get_object_settings(model, 0)` — three object-level settings, as `[index, kind, value]`. */
const OBJECT_SETTINGS: [number, number, unknown][] = [
  [52, 1, 1.4], // sphere_scale
  [65, 1, 0.25], // stick_radius
  [220, 2, 1], // surface_quality
];

/** `get_object_settings(model, state)` — one object-state-level setting. */
const OSTATE_SETTINGS: [number, number, unknown][] = [
  [187, 1, 0.5], // cartoon_transparency
];

/** Answer one bridge call the way a live inspection session would. */
function propertiesCall(fn: string, args?: unknown[]): unknown {
  const a = args ?? [];
  switch (fn) {
    case 'get_object_list':
      // Bare -> the object list; with a selection arg -> the owning object.
      return a.length === 0 ? OBJECTS : [MODEL];
    case 'get_state':
      return 1;
    case 'get_names':
      return ['pk1'];
    case 'get_model':
      // `['pk1']` on open, `['1ubq`42', state]` for the picked atom's rows.
      return { __model__: MODEL, atom: [ATOM] };
    case 'index':
      // The follow poll's one-round-trip pk1 probe.
      return [[MODEL, PK1_INDEX]];

    case 'setting.get_name_list':
      return SETTING_NAMES;
    case 'setting.get_index_list':
      return SETTING_INDICES;

    case 'count_atoms':
      return 602;
    case 'count_states':
      return 1;

    case 'get_object_ttt':
      return TTT;
    case 'get_object_settings':
      return a[1] === 0 ? OBJECT_SETTINGS : OSTATE_SETTINGS;
    case 'get_title':
      return 'Ubiquitin';
    case 'get_object_matrix':
      return STATE_MATRIX;

    case 'cmd.tenmol_props.atom_extras':
      return ATOM_EXTRAS;

    // `edit` (movePk1) and any write path: acknowledged, nothing to return.
    default:
      return null;
  }
}

/** Wrap a story in a session that answers the Properties inspector's reads. */
export const withPropertiesData: Decorator = (Story) => {
  const base = mockSession();
  const session: Session = {
    ...base,
    call: ((fn: string, args?: unknown[]) =>
      Promise.resolve(propertiesCall(fn, args))) as Session['call'],
    run: (() => Promise.resolve()) as Session['run'],
  } as Session;
  return (
    <SessionContext.Provider value={session}>
      <Story />
    </SessionContext.Provider>
  );
};
