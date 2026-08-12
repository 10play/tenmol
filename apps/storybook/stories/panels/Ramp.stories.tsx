/**
 * Colour ramps — the real {@link RampPanel} sub-surface of the colours overlay.
 *
 * The `cmd.ramp_new` editor: a stop list (value + colour) that previews as the
 * gradient it defines, plus the volume-ramp preset applier. It takes a
 * {@link PaletteState}; the empty palette is enough for it to render its default
 * red/white/blue stops on the stub session — the modern theme's card chrome on
 * the ramp editor.
 */

import type { Meta, StoryObj } from '@storybook/react-vite';
import { RampPanel } from '@web/features/colors/RampPanel';
import { EMPTY_PALETTE } from '@web/features/colors/palette';

const meta = {
  title: 'Panels/Ramp',
  parameters: { layout: 'padded' },
} satisfies Meta<typeof RampPanel>;

export default meta;
type Story = StoryObj<typeof meta>;

/** The ramp editor with its default stops on an empty palette. */
export const Default: Story = {
  render: () => <RampPanel palette={EMPTY_PALETTE} />,
};
