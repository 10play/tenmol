/**
 * Objects panel — the real {@link ObjectPanel} feature bundle.
 *
 * The names-list / Executive block. `Default` runs on a POPULATED session
 * (`withObjects`): the synthetic `all` row, a couple of structures, an open
 * group with two members, a selection, a coloured distance caption and a map —
 * so the modern floating card shows a genuine object tree with clean name pills
 * and the A/S/H/L/C/M op chips. `Empty` keeps the connected-but-empty state.
 */

import type { Meta, StoryObj } from '@storybook/react-vite';
import { ObjectPanel } from '@web/features/objects/ObjectPanel';

import { withObjects } from './objectsSession';

const meta = {
  title: 'Panels/Objects',
  parameters: { layout: 'padded' },
} satisfies Meta<typeof ObjectPanel>;

export default meta;
type Story = StoryObj<typeof meta>;

/** The object tree on a working session — rows, groups, ops and captions. */
export const Default: Story = {
  decorators: [withObjects],
  render: () => <ObjectPanel />,
};

/** The object tree on an empty session — its connected/empty state. */
export const Empty: Story = {
  render: () => <ObjectPanel />,
};
