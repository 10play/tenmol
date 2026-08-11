/**
 * APBS Electrostatics — the real {@link ApbsPanel} feature bundle.
 *
 * The v1 stub (WP-25 / critique B1): rather than porting the plugin's 86
 * widgets, the panel MEASURES whether `apbs` and `pdb2pqr` exist on this tree
 * (using the plugin's own search order) and reports that the plugin is on the
 * startup path but not imported. On the stub session the probe answers unknown /
 * missing, so the panel shows its honest "not available here" state — the modern
 * theme's floating-card chrome around a genuine, connected probe.
 */

import type { Meta, StoryObj } from '@storybook/react-vite';
import { ApbsPanel } from '@web/features/apbs/ApbsPanel';

const meta = {
  title: 'Panels/APBS',
  parameters: { layout: 'padded' },
} satisfies Meta<typeof ApbsPanel>;

export default meta;
type Story = StoryObj<typeof meta>;

/** The APBS stub panel with its program probe on an idle session. */
export const Default: Story = {
  render: () => <ApbsPanel />,
};
