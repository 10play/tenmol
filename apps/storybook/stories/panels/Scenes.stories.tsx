/**
 * Scenes panel — the real {@link ScenePanel} feature bundle.
 *
 * The stored-scene button strip with Add Scene, rename, reorder and thumbnail
 * columns, mounted on the stub session. With no scenes stored it shows its
 * empty strip and Add control in the modern theme's floating card.
 */

import type { Meta, StoryObj } from '@storybook/react-vite';
import { ScenePanel } from '@web/features/scenes/ScenePanel';
import { withPanelData } from './panelData';

const meta = {
  title: 'Panels/Scenes',
  parameters: { layout: 'padded' },
  decorators: [withPanelData],
} satisfies Meta<typeof ScenePanel>;

export default meta;
type Story = StoryObj<typeof meta>;

/** The scene strip on an empty session. */
export const Default: Story = {
  render: () => <ScenePanel />,
};
