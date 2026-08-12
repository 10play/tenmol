/**
 * Movie panel — the real {@link MoviePanel} feature bundle.
 *
 * The nine-button transport bar, frame readout, seek scrubber, timeline and
 * Movie menu, mounted on a session seeded with a defined 90-frame movie (see
 * {@link withMovieData}). The client never advances a frame — playback is the
 * engine's — so the panel renders the frozen snapshot the seed returns: a
 * camera key-frame track, two object tracks, pinned scenes and a live playhead,
 * all inside the modern theme's card chrome.
 */

import type { Meta, StoryObj } from '@storybook/react-vite';
import { MoviePanel } from '@web/features/movie/MoviePanel';
import { withMovieData } from './movieSession';

const meta = {
  title: 'Panels/Movie',
  parameters: { layout: 'padded' },
  decorators: [withMovieData],
} satisfies Meta<typeof MoviePanel>;

export default meta;
type Story = StoryObj<typeof meta>;

/** The movie transport + timeline on a defined, populated movie. */
export const Default: Story = {
  render: () => <MoviePanel />,
};
