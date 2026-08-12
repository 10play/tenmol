/**
 * Plugins panel — the real {@link PluginManager} feature bundle.
 *
 * NOTE ON THE COMPONENT CHOICE. The "plugins" slot the brief points at
 * (`features/files/PluginDialogHost`) is not a panel: it is a headless host that
 * renders NOTHING until a legacy plugin blocks on a `tkinter.filedialog` call,
 * at which point it pops the shared {@link PathPicker}. There is no standalone
 * plugins surface to show at rest. The user-facing plugins panel is the Plugin
 * Manager (`features/plugin-manager/PluginManager`), so that is mounted here.
 *
 * The stub session answers empty, which renders the panel as "no plugins found";
 * {@link withPlugins} seeds a realistic registry so all four tabs — Installed,
 * Legacy Plugins, Settings, Startup Paths — show real content.
 */

import type { Meta, StoryObj } from '@storybook/react-vite';
import { PluginManager } from '@web/features/plugin-manager/PluginManager';

import { withPlugins } from './pluginsSession';

const meta = {
  title: 'Panels/Plugins',
  component: PluginManager,
  parameters: { layout: 'padded' },
  decorators: [withPlugins],
} satisfies Meta<typeof PluginManager>;

export default meta;
type Story = StoryObj<typeof meta>;

/** The Plugin Manager opened on its Installed tab, seeded with 8 discovered plugins. */
export const Default: Story = {
  render: () => <PluginManager />,
};
