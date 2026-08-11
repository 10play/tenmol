/**
 * Objects panel — the real {@link ObjectPanel} feature bundle.
 *
 * The names-list / Executive block, mounted directly on the stub session's
 * empty `objects` store. With no structure loaded it shows its own empty state
 * ("no objects — type `fragment ala` below"), which is exactly the modern
 * theme's floating-card treatment applied to a genuine control surface.
 */

import type { Meta, StoryObj } from '@storybook/react-vite';
import { ObjectPanel } from '@web/features/objects/ObjectPanel';

const meta = {
  title: 'Panels/Objects',
  parameters: { layout: 'padded' },
} satisfies Meta<typeof ObjectPanel>;

export default meta;
type Story = StoryObj<typeof meta>;

/** The object tree on an empty session — its connected/empty state. */
export const Default: Story = {
  render: () => <ObjectPanel />,
};
