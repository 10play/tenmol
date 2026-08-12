/**
 * Dialogs launcher — the real {@link DialogsPanel} feature bundle.
 *
 * The `dialogs` slot owns a small launcher strip (WP-13's object menu and
 * WP-14's menu bar are not installed yet) that makes the four area-10 windows —
 * Advanced Settings, a per-object Volume panel, Properties and the pymolrc text
 * editor — reachable. It also HOSTS the Advanced Settings window itself.
 *
 * {@link withDialogsData} stands in for a connected engine: its
 * `get_names_of_type` lists two volume objects (so the chooser has real
 * targets) and its `setting.get_name_list` / `get_setting_tuple` / `get`
 * answer a realistic slice of the setting catalogue. {@link
 * withAdvancedSettingsOpen} opens the hosted Advanced Settings window on mount,
 * so the Default story shows the panel doing its real job — a POPULATED,
 * scrollable settings table floating above a connected launcher strip — in the
 * modern theme's floating-card treatment.
 */

import type { Meta, StoryObj } from '@storybook/react-vite';
import { DialogsPanel } from '@web/features/dialogs/DialogsPanel';

import { withDialogsData, withAdvancedSettingsOpen } from './dialogsSession';

const meta = {
  title: 'Panels/Dialogs',
  parameters: { layout: 'padded' },
  decorators: [withDialogsData],
} satisfies Meta<typeof DialogsPanel>;

export default meta;
type Story = StoryObj<typeof meta>;

/**
 * The launcher strip with its hosted Advanced Settings window open on a
 * connected engine — the populated, working state.
 */
export const Default: Story = {
  decorators: [withAdvancedSettingsOpen],
  render: () => <DialogsPanel />,
};

/** Just the launcher strip at rest, no window open — the idle chrome. */
export const Launcher: Story = {
  render: () => <DialogsPanel />,
};
