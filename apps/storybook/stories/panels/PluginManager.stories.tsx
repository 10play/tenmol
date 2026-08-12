/**
 * Plugin Manager panel — the real {@link PluginManager} feature bundle, one
 * story per tab so the workshop can preview every populated surface at rest.
 *
 * The sibling `Panels/Plugins` entry mounts the same component (the brief's
 * "plugins slot", `PluginDialogHost`, is a headless file-dialog host with no
 * standalone rendered state, so the Plugin Manager stands in for it). That entry
 * only ever shows the Installed tab. This file is the Plugin Manager's own home:
 * it reuses the same {@link withPlugins} session that seeds a realistic registry
 * — discovered plugins, live preferences, an editable startup-path list, and a
 * recorded legacy `addmenuitem` tree — and adds a {@link play} function to each
 * non-default story that opens its tab, so Legacy Plugins, Settings, and Startup
 * Paths each render POPULATED instead of hiding behind the Installed tab.
 */

import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, userEvent, within } from 'storybook/test';
import { PluginManager } from '@web/features/plugin-manager/PluginManager';

import { withPlugins } from './pluginsSession';

const meta = {
  title: 'Panels/Plugin Manager',
  component: PluginManager,
  parameters: { layout: 'padded' },
  decorators: [withPlugins],
} satisfies Meta<typeof PluginManager>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Open the tab whose accessible name matches, then confirm it is selected. */
function openTab(name: RegExp): NonNullable<Story['play']> {
  return async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const tab = await canvas.findByRole('tab', { name });
    await userEvent.click(tab);
    await expect(tab).toHaveAttribute('aria-selected', 'true');
  };
}

/** Installed tab: the eight discovered plugins with their autoload checkboxes. */
export const Installed: Story = {
  render: () => <PluginManager />,
};

/** Legacy Plugins tab: the recorded `addmenuitem` menu tree, with a psico submenu. */
export const LegacyPlugins: Story = {
  render: () => <PluginManager />,
  play: openTab(/legacy plugins/i),
};

/** Settings tab: the two writable preferences (`verbose`, `instantsave`). */
export const Settings: Story = {
  render: () => <PluginManager />,
  play: openTab(/^settings$/i),
};

/** Startup Paths tab: the editable user search path over the fixed install tail. */
export const StartupPaths: Story = {
  render: () => <PluginManager />,
  play: openTab(/startup paths/i),
};
