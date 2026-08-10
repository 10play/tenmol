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
  Zap,
} from 'lucide-react';
import { isInstalled, slotsForRegion } from '../features/registry';
import { useStore } from '../app';
import { ToggleButton } from '../ui';
import { panelsStore, togglePanel } from './panelHooks';

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
  apbs: Zap,
};

/**
 * The launcher toggle buttons — one per installed overlay panel. Presentation
 * only carries the icon; the label rides along in the DOM (visually hidden when
 * `iconOnly`) so tooltips, a11y and the class-name tests are unaffected.
 */
export function LauncherButtons({ iconOnly = false }: { iconOnly?: boolean }) {
  const open = useStore(panelsStore(), (state) => state.open);
  const slots = slotsForRegion('overlay').filter((slot) => isInstalled(slot.id));
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
