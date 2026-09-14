/**
 * The overlay-panel launcher, shared by two hosts.
 *
 * Classic renders it as a flush bar in the bottom-right corner (`AppShell`'s
 * `OverlayLayer`); the modern theme instead renders it INLINE in the status bar
 * (`StatusBar`), so the launcher lives in the same strip as the connection
 * state — the placement the classic UI has always had, just with modern
 * components. Both hosts render the SAME buttons from here so the open-set and
 * toggle behaviour cannot drift between them.
 */

import type { LucideIcon } from 'lucide-react';
import {
  AppWindow,
  Blocks,
  Box,
  Cpu,
  FolderOpen,
  Palette,
  Puzzle,
  Settings,
  SlidersHorizontal,
  SquarePen,
} from 'lucide-react';
import { isInstalled, slotsForRegion } from '../features/registry';
import { isLocal, useSession, useStore } from '../app';
import { ToggleButton } from '../ui';
import { panelsStore, togglePanel } from './panelHooks';

/**
 * Overlay panels whose ENTIRE surface is served by the bridge, so they have
 * nothing to show in the browser-only build (`backend === 'local'`) — their
 * launcher is omitted there rather than opening onto a "not ported" panel. A
 * panel that only partially depends on the bridge (Compute, Settings) keeps its
 * launcher and gates its own content; it is NOT listed here.
 */
const LOCAL_UNSUPPORTED_PANELS: ReadonlySet<string> = new Set(['plugin-manager']);

/** Lucide icons for the overlay-launcher panels, keyed by feature slot id. */
export const LAUNCHER_ICONS: Record<string, LucideIcon> = {
  settings: Settings,
  files: FolderOpen,
  dialogs: AppWindow,
  builder: Blocks,
  colors: Palette,
  volume: Box,
  properties: SlidersHorizontal,
  texteditor: SquarePen,
  compute: Cpu,
  'plugin-manager': Puzzle,
};

/**
 * The launcher toggle buttons — one per installed overlay panel. Presentation
 * only carries the icon; the label rides along in the DOM (visually hidden when
 * `iconOnly`) so tooltips, a11y and the class-name tests are unaffected.
 */
export function LauncherButtons({ iconOnly = false }: { iconOnly?: boolean }) {
  const session = useSession();
  const local = isLocal(session);
  const open = useStore(panelsStore(), (state) => state.open);
  const slots = slotsForRegion('overlay')
    .filter((slot) => isInstalled(slot.id))
    .filter((slot) => !(local && LOCAL_UNSUPPORTED_PANELS.has(slot.id)));
  return (
    <>
      {slots.map((slot) => (
        <ToggleButton
          key={slot.id}
          variant="launcher"
          icon={LAUNCHER_ICONS[slot.id]}
          iconOnly={iconOnly}
          title={slot.title}
          pressed={open.includes(slot.id)}
          onClick={() => togglePanel(slot.id)}
        >
          {slot.title}
        </ToggleButton>
      ))}
    </>
  );
}
