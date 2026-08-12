/**
 * Per-story sessions that seed the Wizards panel with a realistic, POPULATED
 * bridge so it renders like a working PyMOL wizard block instead of the hollow
 * "▸ Wizard" stub {@link withPanelData} produces.
 *
 * The panel only reaches for anything once the socket is OPEN: {@link WizardsPanel}
 * gates the `wizards.catalog` fetch on `connection.phase === 'open'`, and
 * {@link useWizard} only polls `wizards.probe` while connected. So both decorators
 * flip the mock connection store to `open()` and then answer the wizard RPCs:
 *
 *   - `wizards.catalog`  the Qt Wizard menu + the full bundled-module list, so the
 *                        launcher's menu shows real, launchable entries.
 *   - `wizards.probe`    the cheap poll; depth 0 (idle) or 1 (a live wizard).
 *   - `wizards.snapshot` the full render state — panel rows + event mask — pulled
 *                        only when the probe says depth > 0.
 *   - `wizards.menu`     the popup a type-3 row opens (the measurement-mode list).
 *
 * `withWizardCatalog` leaves the stack empty (the launcher + its menu); the story
 * opens the menu in a play step. `withActiveWizard` puts the Measurement wizard on
 * the stack so the generic panel renderer + the pick-seam ("mouse-mode") block
 * draw their populated state without any interaction.
 *
 * Not a `*.stories.tsx` file, so Storybook does not index it as a story.
 */

import type { Decorator } from '@storybook/react-vite';
import { SessionContext, type Session } from '@web/app';
import type {
  WizardCatalog,
  WizardMenuResult,
  WizardProbe,
  WizardSnapshot,
} from '@tenmol/protocol/topics/wizard';

import { mockSession } from '../../.storybook/decorators';

/* The RPC names, inlined — the storybook stories dir cannot resolve the protocol
 * package at runtime (only `@tenmol/stores` + the `@web` alias are on its path),
 * so importing them as VALUES would break the module fetch. See `panelData.tsx`,
 * which inlines `WIZARD_PROBE_RPC` for the same reason. The `import type` above is
 * erased, so it is safe. */
const RPC = {
  probe: 'wizards.probe',
  snapshot: 'wizards.snapshot',
  menu: 'wizards.menu',
  catalog: 'wizards.catalog',
} as const;

/** The Qt Wizard menu + the bundled-module list the launcher renders. */
const CATALOG: WizardCatalog = {
  menubar: [
    { kind: 'command', label: 'Appearance', command: 'wizard appearance' },
    { kind: 'command', label: 'Measurement', command: 'wizard measurement' },
    { kind: 'command', label: 'Mutagenesis', command: 'wizard mutagenesis' },
    { kind: 'command', label: 'Pair Fitting', command: 'wizard pair_fit' },
    { kind: 'separator' },
    {
      kind: 'submenu',
      label: 'Demo',
      items: [
        { kind: 'command', label: 'Representations', command: 'replace_wizard demo, reps' },
        { kind: 'command', label: 'Cartoon Ribbons', command: 'replace_wizard demo, cartoon' },
        { kind: 'command', label: 'Roving Detail', command: 'replace_wizard demo, roving' },
        { kind: 'separator' },
        { kind: 'command', label: 'Finish', command: 'replace_wizard demo, finish' },
      ],
    },
    { kind: 'separator' },
    { kind: 'command', label: 'Density Map', command: 'wizard density' },
    { kind: 'command', label: 'Filter', command: 'wizard filter' },
    { kind: 'command', label: 'Sculpting', command: 'wizard sculpting' },
    { kind: 'command', label: 'Label', command: 'wizard label' },
    { kind: 'command', label: 'Charge', command: 'wizard charge' },
  ],
  wizards: [
    { name: 'appearance', cls: 'Appearance', available: true, note: '' },
    { name: 'measurement', cls: 'Measurement', available: true, note: '' },
    { name: 'mutagenesis', cls: 'Mutagenesis', available: true, note: '' },
    { name: 'pair_fit', cls: 'PairFit', available: true, note: '' },
    { name: 'density', cls: 'Density', available: true, note: '' },
    { name: 'filter', cls: 'Filter', available: true, note: '' },
    { name: 'sculpting', cls: 'Sculpting', available: true, note: '' },
    { name: 'label', cls: 'Label', available: true, note: '' },
    { name: 'charge', cls: 'Charge', available: true, note: '' },
    { name: 'cleanup', cls: 'Cleanup', available: true, note: '' },
    { name: 'dssp', cls: 'Dssp', available: true, note: '' },
    { name: 'demo', cls: 'Demo', available: true, note: '' },
    { name: 'message', cls: 'Message', available: true, note: '' },
    { name: 'security', cls: 'Security', available: true, note: '' },
    {
      name: 'apbs',
      cls: 'Apbs',
      available: false,
      note: 'apbs executable not on PATH',
    },
    {
      name: 'stereo',
      cls: 'Stereo',
      available: false,
      note: 'no stereo display available',
    },
  ],
  aliases: { distance: 'measurement', mutagen: 'mutagenesis' },
};

/** The Measurement wizard, one deep on the stack. */
const MEASUREMENT_PROBE: WizardProbe = {
  version: 7,
  depth: 1,
  cls: 'Measurement',
  module: 'measurement',
};

/** Its full render state: a title, a mode popup, and the delete/done buttons. */
const MEASUREMENT_SNAPSHOT: WizardSnapshot = {
  ...MEASUREMENT_PROBE,
  stack: [{ cls: 'Measurement', module: 'measurement' }],
  panel: [
    { index: 0, type: 1, kind: 'text', text: 'Measurement Wizard', code: '' },
    { index: 1, type: 3, kind: 'popup', text: 'Mode: Distances', code: 'mode' },
    {
      index: 2,
      type: 2,
      kind: 'button',
      text: 'Delete Last Object',
      code: 'cmd.get_wizard().delete_last()',
    },
    {
      index: 3,
      type: 2,
      kind: 'button',
      text: 'Delete All Measurements',
      code: 'cmd.get_wizard().delete_all()',
    },
    { index: 4, type: 0, kind: 'blank', text: '', code: '' },
    { index: 5, type: 2, kind: 'button', text: 'Done', code: 'cmd.set_wizard()' },
  ],
  prompt: [],
  // pick | select — the wizard wants both, so the pick-seam block renders.
  eventMask: 3,
  methods: ['do_pick', 'do_select', 'get_panel', 'get_prompt'],
  errors: [],
  promptMode: 1,
};

/** The measurement-mode popup a click on the type-3 row opens. */
const MODE_MENU: WizardMenuResult = {
  tag: 'mode',
  error: null,
  items: [
    { code: 2, kind: 'title', text: 'Measurement Mode' },
    { code: 0, kind: 'separator', text: '' },
    {
      code: 1,
      kind: 'item',
      text: 'Distances',
      command: "cmd.get_wizard().set_mode('distance')",
    },
    { code: 1, kind: 'item', text: 'Angles', command: "cmd.get_wizard().set_mode('angle')" },
    {
      code: 1,
      kind: 'item',
      text: 'Dihedrals',
      command: "cmd.get_wizard().set_mode('dihedral')",
    },
    {
      code: 1,
      kind: 'item',
      text: 'Polar Contacts',
      command: "cmd.get_wizard().set_mode('polar')",
    },
    { code: 0, kind: 'separator', text: '' },
    {
      code: 1,
      kind: 'item',
      text: 'Neighbor Distances',
      command: "cmd.get_wizard().set_mode('neighbor')",
    },
  ],
};

/** Answer one wizard RPC. `depth0` serves the idle stack (launcher only). */
function seededCall(fn: string, depth0: boolean): unknown {
  switch (fn) {
    case RPC.catalog:
      return CATALOG;
    case RPC.probe:
      return depth0 ? { version: 3, depth: 0, cls: null, module: null } : MEASUREMENT_PROBE;
    case RPC.snapshot:
      return MEASUREMENT_SNAPSHOT;
    case RPC.menu:
      return MODE_MENU;
    default:
      return null;
  }
}

/** Build a session on an OPEN socket that answers the wizard RPCs. */
function wizardSession(depth0: boolean): Session {
  const base = mockSession();
  // The panel gates every fetch on an open socket; flip the mock store open.
  base.stores.connection.opened();
  return {
    ...base,
    call: ((fn: string) => Promise.resolve(seededCall(fn, depth0))) as Session['call'],
  } as Session;
}

/** Idle stack: the launcher + its (real) wizard menu, nothing on the stack. */
export const withWizardCatalog: Decorator = (Story) => (
  <SessionContext.Provider value={wizardSession(true)}>
    <Story />
  </SessionContext.Provider>
);

/** The Measurement wizard live: the generic panel + the pick-seam block. */
export const withActiveWizard: Decorator = (Story) => (
  <SessionContext.Provider value={wizardSession(false)}>
    <Story />
  </SessionContext.Provider>
);
