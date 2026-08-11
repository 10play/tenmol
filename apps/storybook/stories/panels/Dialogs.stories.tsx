/**
 * Dialogs launcher — the real {@link DialogsPanel} feature bundle.
 *
 * The `dialogs` slot owns a small launcher strip (WP-13's object menu and
 * WP-14's menu bar are not installed yet) that makes the four area-10 windows —
 * Advanced Settings, a per-object Volume panel, Properties and the pymolrc text
 * editor — reachable. It also HOSTS the Advanced Settings window itself. Mounted
 * on the stub session, whose `get_names_of_type` answers no volume objects, so
 * the volume select is empty and the strip shows its idle chrome — the modern
 * theme's floating-card treatment on a genuine, connected launcher.
 */

import type { Meta, StoryObj } from '@storybook/react-vite';
import { DialogsPanel } from '@web/features/dialogs/DialogsPanel';

const meta = {
  title: 'Panels/Dialogs',
  parameters: { layout: 'padded' },
} satisfies Meta<typeof DialogsPanel>;

export default meta;
type Story = StoryObj<typeof meta>;

/** The dialogs launcher strip at rest on an idle session. */
export const Default: Story = {
  render: () => <DialogsPanel />,
};
