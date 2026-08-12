/**
 * APBS Electrostatics — the real {@link ApbsPanel} feature bundle.
 *
 * The v1 stub (WP-25 / critique B1): rather than porting the plugin's 86
 * widgets, the panel MEASURES whether `apbs` and `pdb2pqr` exist on this tree
 * (using the plugin's own search order) and reports that the plugin is on the
 * startup path but not imported.
 *
 * The default story wraps the panel in {@link withApbsInstalled}, a session that
 * answers the probe as a fully-provisioned host: both binaries resolve to real
 * paths and `apbs_gui` is on the startup path, so the panel renders its
 * POPULATED runnable state — the modern theme's floating-card chrome around a
 * genuine, connected probe. {@link NotInstalled} keeps the honest empty state
 * for contrast (the probe answers "not found" for both programs).
 */

import type { Meta, StoryObj } from '@storybook/react-vite';
import { ApbsPanel } from '@web/features/apbs/ApbsPanel';

import { withApbsInstalled } from './apbsSession';

const meta = {
  title: 'Panels/APBS',
  parameters: { layout: 'padded' },
} satisfies Meta<typeof ApbsPanel>;

export default meta;
type Story = StoryObj<typeof meta>;

/** The APBS panel on a host that HAS the toolchain: resolved paths, runnable pipeline. */
export const Default: Story = {
  decorators: [withApbsInstalled],
  render: () => <ApbsPanel />,
};

/** The honest empty state: neither program is installed, so the port is deferred. */
export const NotInstalled: Story = {
  render: () => <ApbsPanel />,
};
