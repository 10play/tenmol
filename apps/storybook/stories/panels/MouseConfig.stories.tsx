/**
 * Mouse config panel — the real {@link MouseConfigPanel} feature bundle.
 *
 * The full 8-modifier x 10-button matrix of mouse-action dropdowns, mounted on
 * the stub session. Every cell is a real {@link Select}, so this is the modern
 * theme's densest control surface shown at rest.
 */

import type { Meta, StoryObj } from '@storybook/react-vite';
import { MouseConfigPanel } from '@web/features/mouse/MouseConfigPanel';

import { withMouseMode } from './mouseSession';

const meta = {
  title: 'Panels/Mouse Config',
  parameters: { layout: 'padded' },
  decorators: [withMouseMode],
} satisfies Meta<typeof MouseConfigPanel>;

export default meta;
type Story = StoryObj<typeof meta>;

/** The 80-slot mouse-action matrix, seeded with a live 3-Button Viewing mode. */
export const Default: Story = {
  render: () => <MouseConfigPanel />,
};
