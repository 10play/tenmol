/**
 * The `wizards` command subsystem — PyMOL's interactive wizard stack.
 *
 * Ports the `cmd.*_wizard` family that drives the modal helpers in the GUI
 * (`packages/engine/modules/pymol/wizarding.py`,
 * `packages/engine/layer4/Cmd.cpp` `SetWizard`/`SetWizardStack`). PyMOL keeps a
 * LIFO stack of wizard objects in `OrthoWizard`; the active wizard is the top of
 * the stack, contributes the on-screen prompt lines, and can be pushed, popped,
 * or replaced in place.
 *
 * A real wizard is a Python object with `get_prompt()` / event callbacks. Here a
 * wizard is a small serialisable record `{ name, prompt, state }` — enough to
 * reproduce the stack bookkeeping and the prompt readout the console exercises.
 * The heavyweight per-wizard interaction (atom picking, sculpting, …) is not
 * ported; only the stack machine and prompt plumbing are.
 */

import type { Json, JsonObject } from '@tenmol/protocol';
import type { RegistrarCtx } from './registrar';

/** One entry on the wizard stack. `state` is the wizard's opaque scratch data. */
interface Wizard {
  name: string;
  prompt: string[];
  state: JsonObject;
}

/**
 * Default on-screen prompt lines per wizard kind, mirroring the first line each
 * PyMOL wizard's `get_prompt()` returns on activation
 * (`packages/engine/modules/pymol/wizard/*.py`). Unknown kinds fall back to a
 * generic banner.
 */
const DEFAULT_PROMPTS: Readonly<Record<string, string[]>> = {
  measurement: ['Pick atoms to measure distances, angles, and dihedrals.'],
  pair_fit: ['Please pick an atom in the mobile object.'],
  density: ['Please pick a map object to contour.'],
  mutagenesis: ['Pick a residue to mutate.'],
  label: ['Pick atoms to label.'],
  filter: ['Please classify each molecule.'],
  cleanup: ['Pick atoms to clean up.'],
  charge: ['Pick atoms to assign a charge.'],
  sculpting: ['Pick atoms to sculpt.'],
  distance: ['Pick two atoms to measure a distance.'],
};

/** Build a fresh wizard record of the given kind with its default prompt. */
function makeWizard(name: string): Wizard {
  const prompt = DEFAULT_PROMPTS[name];
  return {
    name,
    prompt: prompt ? [...prompt] : [`Wizard: ${name}`],
    state: {},
  };
}

/** A defensive, JSON-safe copy of a wizard (never leak the live reference). */
function copyWizard(w: Wizard): Wizard {
  return { name: w.name, prompt: [...w.prompt], state: { ...w.state } };
}

/**
 * Coerce one element of a `set_wizard_stack` payload into a wizard. Accepts a
 * bare name string (`"measurement"`) or a full `{ name, prompt?, state? }`
 * record. Anything unusable is skipped by the caller.
 */
function coerceWizard(v: unknown): Wizard | null {
  if (typeof v === 'string') return v ? makeWizard(v) : null;
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>;
    const name = o['name'];
    if (typeof name !== 'string' || !name) return null;
    const base = makeWizard(name);
    if (Array.isArray(o['prompt'])) {
      base.prompt = o['prompt'].filter((x): x is string => typeof x === 'string');
    }
    if (o['state'] && typeof o['state'] === 'object' && !Array.isArray(o['state'])) {
      base.state = { ...(o['state'] as JsonObject) };
    }
    return base;
  }
  return null;
}

/** Whether a `replace` flag argument is truthy (accepts `1`, `"1"`, `true`). */
function truthy(v: unknown): boolean {
  if (v == null) return false;
  if (typeof v === 'number') return v !== 0;
  if (typeof v === 'boolean') return v;
  const s = String(v).trim().toLowerCase();
  return s !== '' && s !== '0' && s !== 'false' && s !== 'none';
}

/* ---------------------------------------------------------------------------
 * Base-class / protocol render data (`get_menu` + the launchable catalog).
 *
 * The bridge (`packages/bridge/tenmol_bridge/panels/wizards.py`) serves the
 * launcher's `wizards.catalog` from `pymol.wizard`'s package directory and
 * `wizards.menu` by calling the top wizard's `get_menu(tag)` render method
 * (base class `packages/engine/modules/pymol/wizard/__init__.py:90`). Both are
 * declarative and side-effect free, so they port as static data here.
 * ------------------------------------------------------------------------- */

/** Launch names of the bundled wizards, sorted like the bridge listing. */
const BUNDLED_WIZARDS: readonly string[] = [
  'annotation', 'appearance', 'benchmark', 'box', 'charge', 'cleanup', 'command',
  'demo', 'density', 'distance', 'dragging', 'filter', 'label', 'measurement',
  'message', 'mutagenesis', 'nucmutagenesis', 'openvr', 'pair_fit', 'pseudoatom',
  'renaming', 'sculpting', 'security', 'stereodemo', 'toggle',
];

/**
 * The Qt Wizard menubar, verbatim from `packages/engine/modules/pymol/_gui.py`
 * as serialised by the bridge's `_menubar_json`.
 */
const MENUBAR_JSON: readonly Json[] = [
  { kind: 'command', label: 'Appearance', command: 'wizard appearance' },
  { kind: 'command', label: 'Measurement', command: 'wizard measurement' },
  {
    kind: 'submenu', label: 'Mutagenesis', items: [
      { kind: 'command', label: 'Protein', command: 'wizard mutagenesis' },
      { kind: 'command', label: 'Nucleic Acids', command: 'wizard nucmutagenesis' },
    ],
  },
  { kind: 'command', label: 'Pair Fitting', command: 'wizard pair_fit' },
  { kind: 'separator' },
  { kind: 'command', label: 'Density', command: 'wizard density' },
  { kind: 'command', label: 'Filter', command: 'wizard filter' },
  { kind: 'command', label: 'Sculpting', command: 'wizard sculpting' },
  { kind: 'separator' },
  { kind: 'command', label: 'Label', command: 'wizard label' },
  { kind: 'command', label: 'Charge', command: 'wizard charge' },
  { kind: 'separator' },
  {
    kind: 'submenu', label: 'Demo', items: [
      { kind: 'command', label: 'Representations', command: 'wizard demo, reps' },
      { kind: 'command', label: 'Cartoon Ribbons', command: 'wizard demo, cartoon' },
      { kind: 'command', label: 'Roving Detail', command: 'wizard demo, roving' },
      { kind: 'command', label: 'Roving Density', command: 'wizard demo, roving_density' },
      { kind: 'command', label: 'Transparency', command: 'wizard demo, trans' },
      { kind: 'command', label: 'Ray Tracing', command: 'wizard demo, ray' },
      { kind: 'command', label: 'Sculpting', command: 'wizard demo, sculpt' },
      { kind: 'command', label: 'Scripted Animation', command: 'wizard demo, anime' },
      { kind: 'command', label: 'Electrostatics', command: 'wizard demo, elec' },
      { kind: 'command', label: 'Compiled Graphics Objects', command: 'wizard demo, cgo' },
      { kind: 'command', label: 'Molscript/Raster3D Input', command: 'wizard demo, raster3d' },
      { kind: 'separator' },
      { kind: 'command', label: 'End Demonstration', command: 'replace_wizard demo, finish' },
    ],
  },
];

/** `packages/engine/layer4/PopUp.cpp` menu codes, mirrored by the bridge. */
const MENU_CODES: Readonly<Record<number, string>> = { 0: 'separator', 1: 'item', 2: 'title' };

/**
 * A raw `get_menu` row: `[code, text, third]` where `third` is a command
 * string, a nested submenu, or `''`/`null` for separators and titles — exactly
 * the shape a wizard's `self.menu[tag]` holds.
 */
type RawMenuEntry = [number, string, string | RawMenu | null];
type RawMenu = RawMenuEntry[];

/**
 * Port of the bridge `_encode_menu`: `[[code, text, str|list], ...]` → wire
 * items. Code 0/2 (separator/title) carry no command; a list `third` is a
 * submenu; anything else is a command string.
 */
function encodeMenu(raw: RawMenu): Json[] {
  const items: Json[] = [];
  for (const entry of raw) {
    const code = entry[0];
    const text = code === 0 ? '' : String(entry[1] ?? '');
    const item: Record<string, Json> = { code, kind: MENU_CODES[code] ?? 'unknown', text };
    const third = entry[2];
    if (code === 0 || code === 2 || third == null) {
      items.push(item);
      continue;
    }
    if (Array.isArray(third)) item['submenu'] = encodeMenu(third);
    else item['command'] = String(third);
    items.push(item);
  }
  return items;
}

/** The measurement wizard's `mode` neighbour submenu (`measurement.py:130`). */
function neighborSubmenu(mode: string, label: string): RawMenu {
  return [
    [2, `${label}: `, ''],
    [1, 'in all objects', `cmd.get_wizard().set_neighbor_target("${mode}","all")`],
    // With no objects/selections loaded these resolve to a bare title row
    // (`neighbor_objects`/`neighbor_selections` on an empty session).
    [1, 'in object', [[2, 'Object: ', '']]],
    [1, 'in selection', [[2, 'Selections: ', '']]],
    [1, 'in other objects', `cmd.get_wizard().set_neighbor_target("${mode}","other")`],
    [1, 'in same object', `cmd.get_wizard().set_neighbor_target("${mode}", "same")`],
  ];
}

/**
 * `self.menu` for each wizard whose `get_menu` render method is ported. Only
 * the measurement wizard's declarative menus are needed today; other wizards
 * fall through to "get_menu returned None".
 */
const WIZARD_MENUS: Readonly<Record<string, Readonly<Record<string, RawMenu>>>> = {
  measurement: {
    mode: [
      [2, 'Measurement Mode', ''],
      [1, 'Distances', 'cmd.get_wizard().set_mode("pairs")'],
      [1, 'Distances to Rings', 'cmd.get_wizard().set_mode("rings")'],
      [1, 'Angles', 'cmd.get_wizard().set_mode("angle")'],
      [1, 'Dihedrals', 'cmd.get_wizard().set_mode("dihed")'],
      [1, 'Polar Neighbors', neighborSubmenu('polar', 'Polar Neighbors')],
      [1, 'Heavy Neighbors', neighborSubmenu('heavy', 'Heavy Neighbors')],
      [1, 'Neighbors', neighborSubmenu('neigh', 'Neighbors')],
      [1, 'Polar Contacts', 'cmd.get_wizard().set_mode("hbond")'],
    ],
    object_mode: [
      [2, 'New Measurements?', ''],
      [1, 'Merge With Previous', 'cmd.get_wizard().set_object_mode("merge")'],
      [1, 'Replace Previous', 'cmd.get_wizard().set_object_mode("overwr")'],
      [1, 'Create New Object', 'cmd.get_wizard().set_object_mode("append")'],
    ],
  },
};

export function registerWizards(ctx: RegistrarCtx): void {
  /** The LIFO wizard stack; the top (last element) is the active wizard. */
  const stack: Wizard[] = [];

  const top = (): Wizard | undefined => (stack.length ? stack[stack.length - 1] : undefined);

  /**
   * `cmd.wizard(name, ...)` — instantiate and push a wizard of kind `name`.
   * A falsy/omitted name clears the active wizard (PyMOL: `wizard()` with no
   * name calls `set_wizard()`). Returns the active wizard's name, or None.
   */
  ctx.command('wizard', (args) => {
    const raw = args[0];
    const name = raw == null ? '' : String(raw);
    if (!name || name.toLowerCase() === 'none') {
      stack.pop();
    } else {
      stack.push(makeWizard(name));
    }
    const t = top();
    return t ? t.name : null;
  });

  /**
   * `cmd.set_wizard(wizard=None, replace=0)` — push `wizard` onto the stack, or
   * (with `replace`) overwrite the top in place. A None wizard pops the top;
   * popping past empty leaves None active.
   */
  ctx.command('set_wizard', (args, kwargs) => {
    const raw = 'wizard' in kwargs ? kwargs['wizard'] : args[0];
    const replace = truthy('replace' in kwargs ? kwargs['replace'] : args[1]);
    const w = raw == null || raw === '' ? null : coerceWizard(raw);
    if (!w) {
      // None => drop the active wizard.
      stack.pop();
    } else if (replace && stack.length) {
      stack[stack.length - 1] = w;
    } else {
      stack.push(w);
    }
    return null;
  });

  /**
   * `cmd.replace_wizard(old, new)` — swap the active wizard for a fresh one of
   * kind `new`, but only when the current top is of kind `old` (PyMOL guards the
   * replacement on the outgoing wizard's identity).
   */
  ctx.command('replace_wizard', (args) => {
    const oldName = args[0] == null ? '' : String(args[0]);
    const newName = args[1] == null ? '' : String(args[1]);
    const t = top();
    if (t && t.name === oldName && newName) {
      stack[stack.length - 1] = makeWizard(newName);
    }
    return top()?.name ?? null;
  });

  /** `cmd.get_wizard()` — the active wizard's name, or None when empty. */
  ctx.command('get_wizard', () => {
    const t = top();
    return t ? t.name : null;
  });

  /** `cmd.get_wizard_prompt()` — the active wizard's prompt lines, or None. */
  ctx.command('get_wizard_prompt', () => {
    const t = top();
    return t ? [...t.prompt] : null;
  });

  /** `cmd.refresh_wizard()` — redraw hook; no state change in this port. */
  ctx.command('refresh_wizard', () => null);

  /** `cmd.get_wizard_stack()` — the whole stack, bottom-to-top, as records. */
  ctx.command('get_wizard_stack', () => stack.map(copyWizard) as unknown as Json);

  /**
   * `cmd.set_wizard_stack(stack)` — replace the entire stack. Elements may be
   * wizard names or `{ name, prompt?, state? }` records; unusable entries drop.
   */
  ctx.command('set_wizard_stack', (args, kwargs) => {
    const raw = 'stack' in kwargs ? kwargs['stack'] : args[0];
    stack.length = 0;
    if (Array.isArray(raw)) {
      for (const el of raw) {
        const w = coerceWizard(el);
        if (w) stack.push(w);
      }
    }
    return null;
  });

  /* ----------------------- app panel RPC endpoints ---------------------- */
  // The web app's Wizard panel polls `wizards.probe` and, when a wizard is
  // active, `wizards.snapshot`; the launcher reads `wizards.catalog`. These are
  // the app<->engine RPCs (not PyMOL cmd verbs), returning the live stack state.

  let version = 0;
  let lastSig = '';
  const clsOf = (w: Wizard): string => w.name.charAt(0).toUpperCase() + w.name.slice(1);
  const probe = (): Json => {
    const t = top();
    const sig = `${stack.length}|${t?.name ?? ''}`;
    if (sig !== lastSig) {
      version++;
      lastSig = sig;
    }
    return {
      version,
      depth: stack.length,
      cls: t ? clsOf(t) : null,
      module: t ? `pymol.wizard.${t.name}` : null,
    };
  };
  ctx.command('wizards.probe', probe);
  ctx.command('wizards.snapshot', () => {
    const base = probe() as Record<string, unknown>;
    const t = top();
    return {
      ...base,
      stack: stack.map((w) => ({ cls: clsOf(w), module: `pymol.wizard.${w.name}` })),
      panel: [],
      prompt: t ? t.prompt : [],
      eventMask: 0,
      methods: [],
      errors: [],
      promptMode: t ? 2 : 0,
    };
  });
  ctx.command('wizards.catalog', () => ({
    // Every bundled wizard renders through the one generic protocol, so the
    // catalog is a static enumeration (`name.capitalize()` gives the class).
    wizards: BUNDLED_WIZARDS.map((name) => ({
      name,
      cls: name.charAt(0).toUpperCase() + name.slice(1),
      available: true,
      note: '',
    })),
    menubar: MENUBAR_JSON.map((m) => m),
    // `wizarding.py:88-89`: cmd.wizard('distance') is rewritten.
    aliases: { distance: 'measurement' },
  }));
  ctx.command('wizards.launch', (args) => {
    const name = args[0] == null ? '' : String(args[0]);
    if (name && name.toLowerCase() !== 'none') stack.push(makeWizard(name));
    return probe();
  });
  ctx.command('wizards.dismiss', (_args, kwargs) => {
    if (kwargs.all) stack.length = 0;
    else stack.pop();
    return probe();
  });
  ctx.command('wizards.menu', (args) => {
    const tag = args[0] == null ? '' : String(args[0]);
    const t = top();
    if (!t) return { tag, items: null, error: 'no wizard' };
    const menus = WIZARD_MENUS[t.name];
    // Every bundled wizard subclasses the base `get_menu`, so the method is
    // always present; an unknown tag means `get_menu` returned None.
    const raw = menus ? menus[tag] : undefined;
    if (!raw) return { tag, items: null, error: null };
    return { tag, items: encodeMenu(raw), error: null };
  });
  ctx.command('wizards.event', () => probe());
  ctx.command('wizards.exec_code', () => null);
}
