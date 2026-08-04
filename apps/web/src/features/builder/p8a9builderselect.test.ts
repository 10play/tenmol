/**
 * Wave 8, parity area 9: the `do_select` hook the AtomFlagWizard needs.
 *
 * `AtomFlagWizard` (`packages/engine/modules/pmg_qt/builder.py:906-913`) treats an edit of the
 * `_build_display` named selection as an edit of the fixed/restrained atom set.
 * PyMOL fires `wizard.do_select` only from ITS OWN mouse paths
 * (`packages/engine/layer1/SceneMouse.cpp:135,357`, `packages/engine/layer3/Seeker.cpp:150,231`,
 * `packages/engine/layer3/Executive.cpp:7563` — the box select); `cmd.select` never fires it.
 * In this client that selection is edited by the object panel, so the hook is
 * an explicit RPC, and this pins its name and shape against the backend's own
 * entry-point table read off disk.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import type { BuilderState } from '@tenmol/protocol/topics/builder';
import { createBuilderController } from './controller';

const REPO = join(import.meta.dirname, '../../../../..');
const BRIDGE_BUILDER = join(REPO, 'packages/bridge/tenmol_bridge/panels/builder.py');
const bridgeSource = readFileSync(BRIDGE_BUILDER, 'utf8');

const RPC = 'cmd.builder_select';

const emptyState = (): BuilderState =>
  ({
    editor: { picked: [], slots: [], hasBond: false, nFrag: 0, active: false, hasActiveSele: false },
    mouse: { button_mode: 0, mode_name: 'three_button_editing', editing: true },
    wizard: null,
    settings: {
      clean_electro_mode: 1,
      sculpt_vdw_vis_mode: 0,
      suspend_undo: 0,
      valence: 1,
      auto_overlay: 1,
      editor_auto_measure: 0,
      secondary_structure: 1,
      auto_remove_hydrogens: 0,
      sculpting: 0,
      sculpting_cycles: 10,
    },
    clean_available: false,
    clean_reason: 'Incentive-only',
    undo_is_noop: true,
    objects: [],
  }) as BuilderState;

describe('controller.selectionEdited', () => {
  it('calls the leaf the bridge installs, with the selection name positional', async () => {
    const run = vi.fn().mockResolvedValue(undefined);
    const call = vi.fn().mockResolvedValue(emptyState());
    const controller = createBuilderController({ call, run });

    await controller.selectionEdited('_build_display');

    expect(call).toHaveBeenCalledTimes(1);
    expect(call.mock.calls[0]?.[0]).toBe(RPC);
    expect(call.mock.calls[0]?.[1]).toEqual(['_build_display']);
    // Bootstrapped like every other leaf: the install is per connection.
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('retries the bootstrap when the leaf vanished with the PyMOL instance', async () => {
    const run = vi.fn().mockResolvedValue(undefined);
    const call = vi
      .fn()
      .mockRejectedValueOnce(new Error('cmd.builder_select: no such symbol'))
      .mockResolvedValue(emptyState());
    const controller = createBuilderController({ call, run });

    await controller.selectionEdited('_build_display');
    expect(run).toHaveBeenCalledTimes(2);
  });

  it('names a leaf the bridge actually installs', () => {
    const leaf = RPC.slice('cmd.'.length);
    // _ENTRY_POINTS is the install table; a typo here would be a dead button.
    expect(bridgeSource).toContain(`"${leaf}": builder_select,`);
    expect(bridgeSource).toContain('def builder_select(cmd: Any, selection: str)');
    // And the wizard method it exists to reach.
    expect(bridgeSource).toContain('def do_select(self, selection: str) -> None:');
  });
});
