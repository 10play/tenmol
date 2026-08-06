/**
 * The `shortcuts` service slot: it mounts the ButMode block and hosts the
 * mouse/keyboard configuration overlay.
 *
 * WHY THE BUTMODE BLOCK IS PORTALLED. `features/registry.ts` is frozen and
 * declares no slot for it (`internal-gui` has objects / wizards / movie /
 * scenes). A `features/mouse/register.ts` would never render — the shell only
 * walks `FEATURE_SLOTS` — so the block is portalled into the `.internal-gui`
 * column from here, the service slot WP-23 owns. PyMOL stacks it between the
 * Wizard block and the movie Control block (`OrthoLayoutPanel`,
 * `packages/engine/layer1/Ortho.cpp:2261-2340`); until a real slot exists it lands at the end
 * of the column, which is the same place while `movie` and `scenes` are not
 * installed. A registry slot is requested rather than smuggled in.
 */

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useSession, useStore } from '../../app';
import { ButModeBlock, MouseConfigPanel } from '../mouse';
import { ShortcutEditor } from './ShortcutEditor';
import './shortcuts.css';

/** Service slot that portals in the ButMode block and hosts the mouse/key config overlay. */
export function ShortcutsService() {
  const session = useSession();
  const internalGui = useStore(session.stores.ui, (state) => state.internalGui);
  const [host, setHost] = useState<HTMLElement | null>(null);
  const [panel, setPanel] = useState<'none' | 'mouse' | 'keys'>('none');

  // The column is rendered by the shell and may appear/disappear with
  // `internal_gui`; re-look it up whenever that changes, and once more on the
  // next frame because the shell's own children mount lazily.
  useEffect(() => {
    if (!internalGui) {
      setHost(null);
      return undefined;
    }
    const find = () => setHost(document.querySelector<HTMLElement>('.internal-gui'));
    find();
    const raf = requestAnimationFrame(find);
    return () => cancelAnimationFrame(raf);
  }, [internalGui]);

  const block = (
    <div className="butmode-host">
      <ButModeBlock />
      <button
        type="button"
        className="butmode__config"
        data-testid="butmode-config"
        title="mouse configuration matrix and keyboard shortcuts"
        onClick={() => setPanel('mouse')}
      >
        Mouse &amp; Keys…
      </button>
    </div>
  );

  return (
    <>
      {host !== null && createPortal(block, host)}
      {panel === 'mouse' && (
        <div className="scmodal" role="dialog" aria-label="Mouse configuration">
          <div className="scmodal__box scmodal__box--wide" data-testid="mouse-config">
            <div className="scmodal__head">
              <span className="scmodal__title">Mouse configuration</span>
              <button
                type="button"
                className="scmodal__x"
                onClick={() => setPanel('none')}
                aria-label="Close"
              >
                ×
              </button>
            </div>
            <MouseConfigPanel />
            <div className="scmodal__buttons">
              <button type="button" onClick={() => setPanel('keys')}>
                Keyboard Shortcut Menu…
              </button>
            </div>
          </div>
        </div>
      )}
      {panel === 'keys' && <ShortcutEditor onClose={() => setPanel('none')} />}
    </>
  );
}
