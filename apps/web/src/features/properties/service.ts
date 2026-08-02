/**
 * Every bridge call the properties inspector makes.
 *
 * READ:
 *   cmd.get_object_list()                 the object combo (querying.py)
 *   cmd.get_state()                       initial state
 *   cmd.count_atoms('?'+model)            index spinner maximum
 *   cmd.count_states('?'+model)           state spinner maximum
 *   cmd.get_object_ttt(model)             Object-Level > TTT Matrix
 *   cmd.get_object_settings(model, 0)     Object-Level > Settings
 *   cmd.get_title(model, state)           Object-State-Level > Title
 *   cmd.get_object_matrix(model, state,0) Object-State-Level > State Matrix
 *   cmd.get_object_settings(model,state)  Object-State-Level > Settings
 *   cmd.get_model('<model>`<index>')      Atom-Level + Atom-State-Level
 *   cmd.get_names('selections')           does a `pk1` exist?
 *
 * WRITE (`properties_dialog.py:150-227` / `:229-286`):
 *   cmd.edit                cmd.set_object_ttt   cmd.set_title
 *   cmd.matrix_reset        cmd.transform_object cmd.safe_eval
 *   cmd.set / cmd.unset     cmd.alter / cmd.alter_state
 *
 * WHAT CANNOT CROSS THE WIRE, and what was done about it. Qt fills the atom
 * rows with
 *
 *     cmd.iterate('pk1', 'update_atom_fields(locals())', space={...})
 *
 * — a Python CALLBACK in `space`. A callback cannot be sent, and neither can
 * the RESULT: `iterate` returns the atom COUNT and mutates `space` server-side,
 * so a dict sent from here is populated in a copy this side never sees
 * (asserted in `bridge/tests/test_properties.py`).
 *
 * Most rows come from `cmd.get_model(sel)`, whose chempy `Atom` carries all 11
 * identifiers and 12 of the 19 built-ins. The remaining seven —
 * `reps`, `label`, `cartoon`, `protons`, `geom`, `valence`, `color` — come from
 * `cmd.tenmol_props.atom_extras` (`bridge/tenmol_bridge/panels/properties.py`),
 * the server-side helper the inventory row asked for. `color` is in that list
 * because chempy does NOT have it: this file used to map `atom.color`, so the
 * row rendered from `undefined`.
 *
 * Atom-level SETTINGS stay unavailable, and that is a PyMOL limit rather than a
 * missing endpoint: `s.<name>` inside `iterate` returns the EFFECTIVE value
 * (falling back to object and global), there is no `get_atom_settings`, and
 * `s.all` raises `LookupError`. The helper reports that reason as data so the
 * panel can show it.
 */

import type { Session } from '../../app';
import type { PropertyRow } from '@tenmol/protocol/topics/dialogs';
import { KEYS, coerceToPythonLiteral, formatValue, inferOldKind, oneLetter } from './model';

/** `bridge/tenmol_bridge/panels/properties.py`, bootstrapped like the others. */
export const PROPS_NS = 'cmd.tenmol_props';
export const PROPS_BOOTSTRAP = 'import tenmol_bridge.panels.properties as _tp; _tp.install()';

export interface AtomExtras {
  ok: boolean;
  found: boolean;
  builtins: Record<string, unknown>;
  properties: Record<string, unknown>;
}

/**
 * Probe, and only bootstrap if the probe fails.
 *
 * The PyMOL process survives a socket drop but a bridge restart does not, and
 * this side cannot tell the two apart cheaply — same reasoning as
 * `filesApi.ensure()`.
 */
export async function atomExtras(
  session: Session,
  model: string,
  index: number,
  state: number,
): Promise<AtomExtras | null> {
  const empty: AtomExtras = { ok: false, found: false, builtins: {}, properties: {} };
  const fetch = () => session.call<AtomExtras>(`${PROPS_NS}.atom_extras`, [model, index, state]);
  try {
    return await fetch();
  } catch {
    try {
      await session.run(PROPS_BOOTSTRAP);
      return await fetch();
    } catch {
      // The panel still renders every other row; these become `unavailable`.
      return empty;
    }
  }
}

const NEEDS_HELPER = 'the bridge helper cmd.tenmol_props is not installed';
const NO_ATOM_SETTINGS =
  'PyMOL does not expose which settings are set on an atom: s.<name> in iterate ' +
  'returns the effective value, there is no get_atom_settings, and s.all raises ' +
  'LookupError. Set one with alter s.<name> = ...';

export interface AtomRecord {
  index?: number;
  id?: number;
  rank?: number;
  name?: string;
  symbol?: string;
  elem?: string;
  resn?: string;
  resi?: string;
  chain?: string;
  segi?: string;
  alt?: string;
  ss?: string;
  b?: number;
  q?: number;
  vdw?: number;
  elec_radius?: number;
  partial_charge?: number;
  formal_charge?: number;
  numeric_type?: number;
  text_type?: string;
  coord?: number[];
  color?: number;
  flags?: number;
  hetatm?: number;
}

export interface ChempyModel {
  __model__?: string;
  atom?: AtomRecord[];
}

export interface HeaderState {
  objects: string[];
  model: string;
  state: number;
  index: number;
  maxState: number;
  maxIndex: number;
}

/** `get_object_names` (`properties_dialog.py:36-40`) — object list, not `get_names`. */
export async function objectList(session: Session): Promise<string[]> {
  const names = await session.call<string[]>('get_object_list');
  return Array.isArray(names) ? names : [];
}

export async function currentState(session: Session): Promise<number> {
  const state = await session.call<number>('get_state');
  return typeof state === 'number' && state > 0 ? state : 1;
}

/**
 * `update_from_pk1` (`properties_dialog.py:324-329`). Qt reads model+index out
 * of an `iterate` namespace; `cmd.get_model('pk1')` answers the same two fields
 * without a callback, and `cmd.get_names('selections')` says whether a pk1
 * exists at all (which is what `update_model_list` checks at `:414`).
 */
export async function readPk1(session: Session): Promise<{ model: string; index: number } | null> {
  const selections = await session.call<string[]>('get_names', ['selections']);
  if (!Array.isArray(selections) || !selections.includes('pk1')) return null;
  const model = await session.call<ChempyModel>('get_model', ['pk1']);
  const atom = model?.atom?.[0];
  if (!atom || atom.index === undefined) return null;
  // get_model does not carry the object name; ask which object owns pk1.
  const owners = await session.call<string[]>('get_object_list', ['pk1']);
  const owner = Array.isArray(owners) && owners.length > 0 ? owners[0]! : '';
  return { model: owner, index: atom.index };
}

/**
 * The same answer as {@link readPk1} in ONE call, for the follow poll.
 *
 * `cmd.index('?pk1')` returns `[[model, index]]`, or `[]` when nothing is
 * picked. Measured over the socket in `bridge/tests/test_p8_a10.py`, including
 * the two things that make it usable on a timer where `readPk1` is not:
 *
 *   * it is ONE round trip, not three (`get_names` + `get_model` +
 *     `get_object_list`), and it carries no coordinates;
 *   * the `?` prefix is load-bearing. Bare `pk1` raises
 *     ` Error: invalid selection` when there is no pick, so an unpicked session
 *     would produce an error frame every poll interval.
 *
 * `readPk1` is kept for the open/Refresh path: it is the port of upstream's
 * `update_from_pk1` and this is not.
 */
export async function probePk1(session: Session): Promise<{ model: string; index: number } | null> {
  const rows = await session.call<[string, number][]>('index', ['?pk1']);
  const first = Array.isArray(rows) ? rows[0] : undefined;
  if (!first || typeof first[0] !== 'string' || typeof first[1] !== 'number') return null;
  return { model: first[0], index: first[1] };
}

/** `update_pk1` (`properties_dialog.py:330-341`) — move the pk1 pick. */
export async function movePk1(session: Session, model: string, index: number): Promise<boolean> {
  if (!model || !index) return false;
  try {
    // `cmd.edit((model, index))` in Qt. The backtick form is the same selection
    // and survives JSON, where a Python tuple would arrive as a list.
    await session.call('edit', [`${model}\`${index}`]);
    return true;
  } catch {
    return false;
  }
}

export async function counts(
  session: Session,
  model: string,
): Promise<{ atoms: number; states: number }> {
  const [atoms, states] = await Promise.all([
    session.call<number>('count_atoms', [`?${model}`]),
    session.call<number>('count_states', [`?${model}`]),
  ]);
  return { atoms: Number(atoms) || 0, states: Number(states) || 0 };
}

/* ------------------------------------------------------------------ reads */

export async function objectRows(session: Session, model: string): Promise<PropertyRow[]> {
  const ttt = await session.call<number[] | null>('get_object_ttt', [model]);
  return [
    {
      branch: 'object-ttt',
      key: 'TTT Matrix',
      text: ttt ? formatValue('', ttt) : '',
    },
  ];
}

export async function settingRows(
  session: Session,
  model: string,
  state: number,
  branch: 'object-settings' | 'ostate-settings',
): Promise<PropertyRow[]> {
  // `update_object_settings` (`properties_dialog.py:293-299`): state 0 means
  // the OBJECT level, any other value the object-state level.
  const items = await session.call<[number, number, unknown][] | null>('get_object_settings', [
    model,
    state,
  ]);
  if (!Array.isArray(items)) return [];
  return items.map((item) => ({
    branch,
    // Qt maps the numeric index through `setting.name_dict`; the bridge has no
    // getter for that table, so the index travels as the key and the panel
    // resolves the label from the name list it already fetched.
    key: String(item[0]),
    text: formatValue('', item[2]),
  }));
}

export async function ostateRows(
  session: Session,
  model: string,
  state: number,
): Promise<PropertyRow[]> {
  const [title, matrix] = await Promise.all([
    session.call<string>('get_title', [model, state]),
    session.call<number[] | null>('get_object_matrix', [model, state, 0]),
  ]);
  return [
    { branch: 'ostate-title', key: 'Title', text: String(title ?? '') },
    { branch: 'ostate-matrix', key: 'State Matrix', text: matrix ? formatValue('', matrix) : '' },
  ];
}

export interface AtomRows {
  identifiers: PropertyRow[];
  builtins: PropertyRow[];
  astate: PropertyRow[];
  /** Custom atom properties (`p.*`) — upstream hides this branch. */
  properties: PropertyRow[];
  found: boolean;
}

export async function atomRows(
  session: Session,
  model: string,
  index: number,
  state: number,
): Promise<AtomRows> {
  const empty: AtomRows = {
    identifiers: [],
    builtins: [],
    astate: [],
    properties: [],
    found: false,
  };
  if (!model || !index) return empty;
  let chempy: ChempyModel;
  try {
    chempy = await session.call<ChempyModel>('get_model', [`${model}\`${index}`, state]);
  } catch {
    return empty;
  }
  const atom = chempy?.atom?.[0];
  if (!atom) return empty;

  // The seven built-ins chempy has no field for.
  const extras = await atomExtras(session, model, index, state);

  const values: Record<string, unknown> = {
    model,
    index: atom.index,
    segi: atom.segi ?? '',
    chain: atom.chain ?? '',
    resi: atom.resi ?? '',
    resn: atom.resn ?? '',
    oneletter: oneLetter(atom.resn ?? ''),
    name: atom.name ?? '',
    alt: atom.alt ?? '',
    ID: atom.id,
    rank: atom.rank,

    elem: atom.symbol ?? atom.elem ?? '',
    q: atom.q,
    b: atom.b,
    type: atom.hetatm ? 'HETATM' : 'ATOM',
    formal_charge: atom.formal_charge,
    partial_charge: atom.partial_charge,
    numeric_type: atom.numeric_type,
    text_type: atom.text_type ?? '',
    vdw: atom.vdw,
    ss: atom.ss ?? '',
    flags: atom.flags,
    elec_radius: atom.elec_radius,

    // `color` is NOT a chempy field — it arrives with the other six.
    ...(extras?.found ? extras.builtins : {}),
  };

  const identifiers: PropertyRow[] = KEYS.identifiers.map((key) => ({
    branch: 'atom-identifier',
    key,
    text: formatValue(key, values[key]),
    readOnly: key === 'model' || key === 'index' || key === 'oneletter',
  }));

  const builtins: PropertyRow[] = KEYS.atomBuiltins.map((key) =>
    key in values
      ? { branch: 'atom-builtin', key, text: formatValue(key, values[key]) }
      : { branch: 'atom-builtin', key, text: '', unavailable: NEEDS_HELPER },
  );

  const coord = atom.coord ?? [];
  const astateValues: Record<string, unknown> = {
    state,
    x: coord[0],
    y: coord[1],
    z: coord[2],
  };
  const astate: PropertyRow[] = KEYS.astateBuiltins.map((key) => ({
    branch: 'astate-builtin',
    key,
    text: formatValue(key, astateValues[key]),
    readOnly: key === 'state',
  }));

  return { identifiers, builtins, astate, properties: atomPropertyRows(extras), found: true };
}

/** The two branches nothing but a bridge helper can fill. */
export function atomSettingsPlaceholder(): PropertyRow[] {
  return [{ branch: 'atom-settings', key: 's.*', text: '', unavailable: NO_ATOM_SETTINGS }];
}

/**
 * Atom-level custom properties, from `p.all`.
 *
 * Upstream marks this branch "Incentive only" and hides it in open-source
 * builds (`properties_dialog.py:107`). Measured, `p.all` works here, so the
 * rows are real rather than greyed out.
 */
export function atomPropertyRows(extras: AtomExtras | null): PropertyRow[] {
  const entries = Object.entries(extras?.properties ?? {});
  if (entries.length === 0) {
    return [
      {
        branch: 'atom-property',
        key: 'p.*',
        text: '',
        unavailable: 'no custom properties on this atom',
      },
    ];
  }
  return entries.map(([key, value]) => ({
    branch: 'atom-property',
    key: `p.${key}`,
    text: formatValue(key, value),
  }));
}

export function astateSettingsPlaceholder(): PropertyRow[] {
  return [{ branch: 'astate-settings', key: 's.*', text: '', unavailable: NO_ATOM_SETTINGS }];
}

/* ------------------------------------------------------------------ edits */

export interface EditContext {
  model: string;
  state: number;
}

/**
 * `item_changed` (`properties_dialog.py:150-227`), branch for branch.
 *
 * Every failure is re-thrown so the panel can show it and reload the tree —
 * which is what upstream does with `PopupOnException` plus its
 * `if not result: self.update_treewidget_model()`.
 */
export async function applyEdit(
  session: Session,
  ctx: EditContext,
  row: PropertyRow,
  text: string,
): Promise<void> {
  const { model, state } = ctx;
  switch (row.branch) {
    case 'object-ttt':
      if (!text) return;
      // `set_object_ttt` evals a string argument itself (`editing.py:2249-2250`).
      await session.call('set_object_ttt', [model, text]);
      return;

    case 'ostate-title':
      await session.call('set_title', [model, state, text]);
      return;

    case 'ostate-matrix': {
      await session.call('matrix_reset', [model, state]);
      const matrix = await session.call<number[]>('safe_eval', [text]);
      await session.call('transform_object', [model, matrix, state]);
      return;
    }

    case 'object-settings':
      await session.call('set', [row.key, text, model], { quiet: 0 });
      return;

    case 'ostate-settings':
      await session.call('set', [row.key, text, model, state], { quiet: 0 });
      return;

    case 'atom-settings':
    case 'astate-settings':
    case 'atom-identifier':
    case 'atom-builtin':
    case 'astate-builtin': {
      const key =
        row.branch === 'atom-settings' || row.branch === 'astate-settings'
          ? `s.${row.key}`
          : row.key;
      // `alter`'s expression IS Python, executed by PyMOL, so the `safe_eval`
      // branch of `get_new_value` needs no round trip: the text is already the
      // literal. Everything else is coerced to the OLD value's type first,
      // which is the whole point of `get_new_value` ('resv = "3"').
      const expression = `${key} = ${coerceToPythonLiteral(inferOldKind(row.text), text).literal}`;
      const isState = row.branch === 'astate-builtin' || row.branch === 'astate-settings';
      if (isState) {
        await session.call('alter_state', [state, 'pk1', expression, 0]);
      } else {
        await session.call('alter', ['pk1', expression, 0]);
      }
      return;
    }
  }
}

/**
 * `unset_item` (`properties_dialog.py:229-286`) — the Delete key.
 *
 * Returns false for the rows upstream treats as no-ops (an empty value, or a
 * branch with no unset semantics), so the caller knows not to reload.
 */
export async function applyUnset(
  session: Session,
  ctx: EditContext,
  row: PropertyRow,
): Promise<boolean> {
  const { model, state } = ctx;
  if (row.text === '') return false;

  switch (row.branch) {
    case 'object-ttt':
      await session.call('matrix_reset', [model], { mode: 1 });
      return true;
    case 'ostate-title':
      await session.call('set_title', [model, state, '']);
      return true;
    case 'ostate-matrix':
      await session.call('matrix_reset', [model, state], { mode: 2 });
      return true;
    case 'object-settings':
      await session.call('unset', [row.key, model], { quiet: 0 });
      return true;
    case 'ostate-settings':
      await session.call('unset', [row.key, model, state], { quiet: 0 });
      return true;
    case 'atom-settings':
      await session.call('alter', ['pk1', `s.${row.key} = None`, 0]);
      return true;
    default:
      // Identifiers, built-ins and atom-state settings have no unset in Qt.
      return false;
  }
}

/** Exported for the tests: the exact `alter` expression an edit will send. */
export function editExpression(key: string, oldText: string, text: string): string {
  return `${key} = ${coerceToPythonLiteral(inferOldKind(oldText), text).literal}`;
}
