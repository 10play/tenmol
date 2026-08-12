/**
 * A per-story session that feeds the real {@link ObjectPanel} a populated panel
 * snapshot, so the names-list renders a genuine object tree instead of its
 * empty "not connected" state.
 *
 * WHY A `call` OVERRIDE RATHER THAN SEEDING THE STORE
 * ===================================================
 * `ObjectPanel` runs a snapshot loop (`SNAPSHOT_HZ`) that, while the connection
 * `phase === 'open'`, calls `cmd.tenmol_objects('snapshot')` and pipes the
 * answer through `store.applySnapshot(...)` AND `setSpecLevels(...)`. Driving it
 * through that same seam is the faithful path: `feed` becomes `'panel'` (the
 * head reads "panel"), and the per-frame `specLevels` land in component state so
 * the M motion chips get their real key/interpolated tint — neither of which a
 * direct `store.applySnapshot` from a decorator can reproduce (the loop would
 * poll `call() -> null` a beat later and clobber the seed).
 *
 * So this decorator (a) flips the mock connection to `open` and (b) answers the
 * one endpoint the panel reads with a realistic {@link PanelSnapshotFull}. The
 * panel then bootstraps exactly as it does against a live bridge.
 *
 * Not a `*.stories.tsx` file, so Storybook does not index it as a story.
 */

import type { Decorator } from '@storybook/react-vite';
import { SessionContext, type Session } from '@web/app';

import { mockSession } from '../../.storybook/decorators';

/** `panels/objects.py` binds itself as `cmd.tenmol_objects`; the panel source
 *  reaches it via `call('tenmol_objects', ['snapshot'])`. Inlined so this helper
 *  needs no protocol dependency the stories dir cannot resolve. */
const PANEL_SYMBOL = 'tenmol_objects';

/** One `PanelSnapshotRow`, loosely typed (the protocol package is off the
 *  stories path); the real {@link PanelSnapshot} shape is what the panel reads. */
interface Row {
  name: string;
  type: string;
  enabled: boolean;
  group: string;
  nest: number;
  reps: number;
  color: number | null;
  caption: string;
  isGroup: boolean;
  isOpen: boolean;
  isAll: boolean;
  repIndices: number[];
  nameColor?: number[];
}

/**
 * A believable working session in `PanelListGroup` order: the synthetic `all`
 * row, a couple of loaded structures, an OPEN group with two members (one of
 * them hidden), a selection, a distance measurement with a coloured caption,
 * and a map. Names are coloured by object colour (name_color_mode 1) so the
 * tree reads like a real PyMOL session, not a grey list.
 */
const ROWS: Row[] = [
  {
    name: 'all',
    type: 'object:group',
    enabled: true,
    group: '',
    nest: 0,
    reps: 0,
    color: null,
    caption: '',
    isGroup: true,
    isOpen: true,
    isAll: true,
    repIndices: [],
  },
  {
    name: '1oky',
    type: 'object:molecule',
    enabled: true,
    group: '',
    nest: 0,
    reps: 0b100011,
    color: 5, // cyan
    caption: '',
    isGroup: false,
    isOpen: false,
    isAll: false,
    repIndices: [0, 1, 5],
    nameColor: [0.4, 0.85, 1.0],
  },
  {
    name: 'ligand',
    type: 'selection',
    enabled: true,
    group: '',
    nest: 0,
    reps: 0,
    color: null,
    caption: '(28 atoms)',
    isGroup: false,
    isOpen: false,
    isAll: false,
    repIndices: [],
  },
  {
    name: 'membrane',
    type: 'object:group',
    enabled: true,
    group: '',
    nest: 0,
    reps: 0,
    color: null,
    caption: '',
    isGroup: true,
    isOpen: true,
    isAll: false,
    repIndices: [],
  },
  {
    name: 'membrane.upper',
    type: 'object:molecule',
    enabled: true,
    group: 'membrane',
    nest: 1,
    reps: 0b000010,
    color: 26, // orange
    caption: '',
    isGroup: false,
    isOpen: false,
    isAll: false,
    repIndices: [1],
    nameColor: [1.0, 0.6, 0.2],
  },
  {
    name: 'membrane.lower',
    type: 'object:molecule',
    enabled: false,
    group: 'membrane',
    nest: 1,
    reps: 0b000010,
    color: 36, // yellow
    caption: '',
    isGroup: false,
    isOpen: false,
    isAll: false,
    repIndices: [1],
    nameColor: [0.95, 0.9, 0.35],
  },
  {
    name: 'dist01',
    type: 'object:measurement',
    enabled: true,
    group: '',
    nest: 0,
    reps: 0,
    color: 4, // yellow-ish
    caption: '\\9903.2 Å',
    isGroup: false,
    isOpen: false,
    isAll: false,
    repIndices: [],
  },
  {
    name: 'density',
    type: 'object:map',
    enabled: false,
    group: '',
    nest: 0,
    reps: 0,
    color: null,
    caption: '1.0 σ',
    isGroup: false,
    isOpen: false,
    isAll: false,
    repIndices: [],
  },
  {
    name: 'pocket',
    type: 'selection',
    enabled: true,
    group: '',
    nest: 0,
    reps: 0,
    color: null,
    caption: '(112 atoms)',
    isGroup: false,
    isOpen: false,
    isAll: false,
    repIndices: [],
  },
];

/** The full snapshot the panel's source reads, including the per-frame extras
 *  (`specLevels`) that tint the M motion chips. */
const SNAPSHOT = {
  rows: ROWS,
  opCount: 6, // '3-Button Motions' — shows the sixth (M) op chip
  buttonMode: '3-Button Motions',
  ops: ['A', 'S', 'H', 'L', 'C', 'M'],
  settings: {
    group_full_member_names: 0,
    group_arrow_prefix: 0,
    internal_gui_name_color_mode: 1,
    internal_gui_control_size: 18,
    internal_gui_width: 220,
    hide_underscore_names: 1,
  },
  // per-object motion spec level at the current frame: 2 = stored key frame,
  // 1 = interpolated. `1oky` sits on a key frame, `membrane.upper` between two.
  specLevels: { '1oky': 2, 'membrane.upper': 1 } as Record<string, number>,
  frame: 1,
  internalGuiMode: 0,
};

/**
 * Wrap a story in a session whose connection is open and whose
 * `cmd.tenmol_objects('snapshot')` returns a populated tree, so the object
 * panel renders real rows, ops and captions.
 */
export const withObjects: Decorator = (Story) => {
  const base = mockSession();
  // Flip the mock connection to `open` so the panel's snapshot loop runs.
  base.stores.connection.setPhase('open');
  const session: Session = {
    ...base,
    call: ((fn: string, args?: readonly unknown[]) => {
      if (fn === PANEL_SYMBOL && args?.[0] === 'snapshot') {
        return Promise.resolve(SNAPSHOT);
      }
      return Promise.resolve(null);
    }) as Session['call'],
  } as Session;
  return (
    <SessionContext.Provider value={session}>
      <Story />
    </SessionContext.Provider>
  );
};
