/**
 * QuickButtons — the External-GUI quick-button grid.
 *
 * The real feature component (`features/console/QuickButtons`) mirrors PyMOL's
 * Qt quick buttons: four rows of `variant="quick"` buttons plus a movie
 * transport row. It reads `useSession`/`useStore` for progress, which the
 * global Storybook decorators satisfy with a stub Session — no live bridge.
 *
 * Flip the toolbar Theme to compare classic (text-only) against modern, and
 * Appearance for light/dark in the modern theme.
 */

import type { Meta, StoryObj } from '@storybook/react-vite';

import { QuickButtons } from '@web/features/console/QuickButtons';

const meta = {
  title: 'Bundles/Quick Buttons',
  component: QuickButtons,
  parameters: { layout: 'padded' },
} satisfies Meta<typeof QuickButtons>;

export default meta;
type Story = StoryObj<typeof meta>;

/**
 * The quick-button grid as it appears in the app, sized to the External GUI
 * column.
 *
 * In the modern theme the buttons gain Lucide icons and flat fills; the classic
 * theme keeps them text-only. The progress/abort row only appears while a ray
 * is in progress (`cmd.get_progress() >= 0`), so with no live bridge it stays
 * hidden here — that is the honest resting state.
 */
export const Default: Story = {
  render: () => (
    <div style={{ width: 240 }}>
      <QuickButtons />
    </div>
  ),
};
