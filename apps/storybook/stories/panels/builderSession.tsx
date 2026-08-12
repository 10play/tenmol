/**
 * A per-story session that drives the molecular {@link BuilderPanel} the way a
 * live editing session would, instead of the empty shell the bare stub draws.
 *
 * WHY THE PANEL IS HOLLOW (AND CRASHES) ON THE STUB. `BuilderPanel` bootstraps
 * on mount by installing `cmd.builder_*` (`session.run`, a no-op here) and then
 * reading `cmd.builder_show`; a 4 Hz poll reads `cmd.builder_state`. The global
 * `withSession` decorator answers every `call()` with `null`, so `apply(null)`
 * dereferences `null.error` and the panel paints a red "Cannot read properties
 * of null" banner over four empty `pk1..pk4` chips, a `mouse mode ?` header and
 * a `nothing picked` footer — the classic hollow shell.
 *
 * WHAT THIS SUPPLIES. The exact {@link BuilderState} shape the ported
 * `_BuilderPanel` handler returns mid-edit on a small ligand: two picked atoms
 * (`pk1` a ring carbon, `pk2` the amide nitrogen) with a bond between them, the
 * mouse rotated into EDITING mode, two loaded objects, and the real settings
 * row (undo enabled, sculpting idle). The panel then lights up its pick chips,
 * arms every bond button's hint, and reads "picked: pk1 pk2 · 2 object(s)" —
 * a genuine populated editor rather than a disconnected placeholder.
 *
 * `cmd.builder_tables` is left null on purpose: `diffTables(null)` returns no
 * drift, so the panel trusts its own compiled-in button tables (which is what
 * ships) instead of showing a spurious "button table drift" warning.
 *
 * Not a `*.stories.tsx` file, so Storybook does not index it as a story.
 */

import type { Decorator } from '@storybook/react-vite';
import { SessionContext, type Session } from '@web/app';

import { mockSession } from '../../.storybook/decorators';

/** The mid-edit editor state: two atoms picked across a live bond. */
const STATE = {
  editor: {
    picked: [
      {
        slot: 'pk1',
        object: 'benzamide',
        index: 6,
        label: '/benzamide//A/BEN`1/C3',
        elem: 'C',
        resn: 'BEN',
        resi: '1',
        name: 'C3',
        formalCharge: 0,
      },
      {
        slot: 'pk2',
        object: 'benzamide',
        index: 9,
        label: '/benzamide//A/BEN`1/N1',
        elem: 'N',
        resn: 'BEN',
        resi: '1',
        name: 'N1',
        formalCharge: 0,
      },
    ],
    slots: ['pk1', 'pk2'],
    hasBond: true,
    nFrag: 1,
    active: true,
    hasActiveSele: true,
  },
  mouse: { button_mode: 1, mode_name: 'Editing', editing: true },
  wizard: null,
  settings: {
    clean_electro_mode: 0,
    sculpt_vdw_vis_mode: 0,
    suspend_undo: 0,
    valence: 1,
    auto_overlay: 0,
    editor_auto_measure: 0,
    secondary_structure: 0,
    auto_remove_hydrogens: 0,
    sculpting: 0,
    sculpting_cycles: 10,
  },
  clean_available: false,
  clean_reason: 'cmd.clean raises IncentiveOnlyException in this build',
  undo_is_noop: true,
  objects: ['benzamide', 'ligand_A'],
};

/** Answer one bridge call the way a live editing session would. */
function builderCall(fn: string): unknown {
  switch (fn) {
    // `showEvent` snapshot and the 4 Hz poll both read the same editor state.
    case 'cmd.builder_show':
    case 'cmd.builder_state':
      return STATE;

    // Left null so `diffTables` reports no drift and the panel keeps its own
    // compiled-in tables (exactly what ships).
    case 'cmd.builder_tables':
      return null;

    default:
      return null;
  }
}

/** Wrap a story in a session that answers the Builder's bootstrap + poll calls. */
export const withBuilderData: Decorator = (Story) => {
  const base = mockSession();
  const session: Session = {
    ...base,
    call: ((fn: string) => Promise.resolve(builderCall(fn))) as Session['call'],
    run: (() => Promise.resolve()) as Session['run'],
  } as Session;
  return (
    <SessionContext.Provider value={session}>
      <Story />
    </SessionContext.Provider>
  );
};
