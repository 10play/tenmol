/**
 * Movie panel — the real {@link MoviePanel} feature bundle.
 *
 * The nine-button transport bar, frame readout, timeline and Movie menu,
 * mounted on the stub session. Nothing advances a frame here (the client never
 * does), so it renders its idle state — the modern theme's card chrome around
 * the genuine movie controls.
 */

import type { Meta, StoryObj } from '@storybook/react-vite';
import { MoviePanel } from '@web/features/movie/MoviePanel';
import { withPanelData } from './panelData';

const meta = {
  title: 'Panels/Movie',
  parameters: { layout: 'padded' },
  decorators: [withPanelData],
} satisfies Meta<typeof MoviePanel>;

export default meta;
type Story = StoryObj<typeof meta>;

/** The movie transport + timeline on an idle session. */
export const Default: Story = {
  render: () => <MoviePanel />,
};
