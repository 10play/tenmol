/**
 * Main View — the whole application shell, assembled from real features.
 *
 * This mounts the real {@link AppShell} (`@web/shell/AppShell`) — the same
 * component the app boots into — inside the Storybook mock session. Because the
 * shell is driven entirely by the feature registry (`slotsForRegion` +
 * `FeatureSlot`), every region fills itself from the genuine feature bundles:
 * the menu bar, the object/movie/scene internal-GUI rail, the docked console
 * (External GUI), and the overlay launcher in the status bar. The centre
 * viewport slot mounts `@tenmol/viewport`; with no bridge behind it, it shows
 * its own idle canvas + HUD (or, if WebGL is unavailable in the runner, its
 * contained error note — the shell stays up either way, by design of the slot
 * error boundaries).
 *
 * The point of this screen is to see the modern theme's floating-card language
 * as ONE composed system at full-window scale, in both light and dark, rather
 * than one panel at a time. Flip the toolbar Theme / Appearance to compare.
 *
 * The session is `withPanelData`, which answers the aggregate bootstrap
 * endpoints (`get_movie_status`, `get_scene_panel`, `wizards.probe`) with valid
 * EMPTY payloads, so the movie / scenes / wizard panels render their real idle
 * chrome instead of dereferencing `null` on mount.
 */

import type { Meta, StoryObj } from '@storybook/react-vite';
import { AppShell } from '@web/shell/AppShell';
import { withPanelData } from '../panels/panelData';

const meta = {
  title: 'Screens/Main View',
  parameters: {
    layout: 'fullscreen',
    // The shell is a full window; it needs the whole frame, not the padded
    // canvas the primitive stories use.
    docs: { story: { inline: false } },
  },
  decorators: [
    withPanelData,
    // Pin the shell to the viewport height so its flex column (menu bar →
    // viewport → status bar) lays out the way it does in the app, instead of
    // collapsing to content height inside Storybook's auto-height canvas.
    (Story) => (
      <div style={{ position: 'fixed', inset: 0, display: 'flex', flexDirection: 'column' }}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof AppShell>;

export default meta;
type Story = StoryObj<typeof meta>;

/** The full main-screen view — menu bar, viewport, internal-GUI rail, console. */
export const Default: Story = {
  render: () => <AppShell />,
};
