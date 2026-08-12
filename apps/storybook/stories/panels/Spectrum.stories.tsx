/**
 * Spectrum & palettes — the real {@link SpectrumPanel} sub-surface of the
 * colours overlay.
 *
 * `cmd.spectrum` and the 60 named palettes of `constants_palette`: a scrollable
 * list of real preview strips (each samples its generated 1000-colour band),
 * the property expression, and the interpolation controls. The palette data is
 * static, so it renders in full on the stub session with an empty
 * {@link PaletteState} — the modern theme's card chrome on the spectrum picker.
 */

import type { Meta, StoryObj } from '@storybook/react-vite';
import { SpectrumPanel } from '@web/features/colors/SpectrumPanel';
import { EMPTY_PALETTE } from '@web/features/colors/palette';

const meta = {
  title: 'Panels/Spectrum',
  parameters: { layout: 'padded' },
} satisfies Meta<typeof SpectrumPanel>;

export default meta;
type Story = StoryObj<typeof meta>;

/** The spectrum picker over the whole `(all)` selection. */
export const Default: Story = {
  render: () => <SpectrumPanel palette={EMPTY_PALETTE} sele="(all)" />,
};
