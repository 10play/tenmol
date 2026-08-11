/**
 * Menu bar — the real {@link MenuBar} feature bundle.
 *
 * PyMOL's top menu bar built from the toolkit-independent menu data
 * (`_gui.py`) plus the dynamic Recent / settings / stereo entries the bridge
 * fills in on open. The bar seeds from the bundled `MENU_DATA` and lazily
 * fetches dynamic values per open, so on the stub session it renders every
 * top-level menu (File, Edit, Build, …) from static data while the dynamic
 * leaves stay idle. The modern theme's chrome on a genuine, connected bar.
 */

import type { Meta, StoryObj } from '@storybook/react-vite';
import { MenuBar } from '@web/features/menubar/MenuBar';

const meta = {
  title: 'Panels/MenuBar',
  parameters: { layout: 'padded' },
} satisfies Meta<typeof MenuBar>;

export default meta;
type Story = StoryObj<typeof meta>;

/** The full menu bar at rest on an idle session. */
export const Default: Story = {
  render: () => <MenuBar />,
};
