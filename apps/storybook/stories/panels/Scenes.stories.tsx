/**
 * Scenes panel — the real {@link ScenePanel} feature bundle.
 *
 * The stored-scene button strip with Add Scene, rename, reorder and thumbnail
 * columns. `Default` is seeded (via {@link withScenesData}) with four stored
 * scenes and four named camera views so the panel renders POPULATED — strip,
 * table, Scene menu and Views list all showing real content — in the modern
 * theme's floating card. `Empty` keeps the idle session to show the empty state.
 */

import type { Meta, StoryObj } from '@storybook/react-vite';
import { ScenePanel } from '@web/features/scenes/ScenePanel';
import { withPanelData } from './panelData';
import { withScenesData } from './scenesSession';

const meta = {
  title: 'Panels/Scenes',
  parameters: { layout: 'padded' },
} satisfies Meta<typeof ScenePanel>;

export default meta;
type Story = StoryObj<typeof meta>;

/** The scene bin with four scenes, thumbnails and named views stored. */
export const Default: Story = {
  decorators: [withScenesData],
  render: () => <ScenePanel />,
};

/** The scene strip on an empty session — its clean empty state. */
export const Empty: Story = {
  decorators: [withPanelData],
  render: () => <ScenePanel />,
};
