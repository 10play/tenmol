/**
 * Wizards panel — the real {@link WizardsPanel} feature bundle.
 *
 * The base stub session is a closed socket with no bridge, so the panel renders a
 * hollow "▸ Wizard" toggle and nothing else. These stories seed an OPEN socket
 * and answer the wizard RPCs (see `wizardsSession.tsx`), so the panel shows its
 * genuine populated chrome:
 *
 *   Default  the launcher with its wizard menu open — the Qt menu + the bundled
 *            module list, the entry point every wizard launches from.
 *   Active   the Measurement wizard live: the generic panel renderer (a title,
 *            a mode popup, delete/done buttons) plus the pick-seam block.
 */

import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, userEvent, waitFor, within } from 'storybook/test';
import { WizardsPanel } from '@web/features/wizards/WizardsPanel';
import { withActiveWizard, withWizardCatalog } from './wizardsSession';

const meta = {
  title: 'Panels/Wizards',
  parameters: { layout: 'padded' },
} satisfies Meta<typeof WizardsPanel>;

export default meta;
type Story = StoryObj<typeof meta>;

/** The launcher with its wizard menu open: the Qt menu + every bundled module. */
export const Default: Story = {
  decorators: [withWizardCatalog],
  render: () => (
    <div style={{ maxWidth: 320 }}>
      <WizardsPanel />
    </div>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    // The catalog resolves a microtask after mount; open the launcher once the
    // toggle is live, then expand the full module list.
    const toggle = await canvas.findByRole('button', { name: /Wizard/i });
    await userEvent.click(toggle);
    const more = await canvas.findByRole('button', { name: /All modules/i });
    await userEvent.click(more);
    // apbs appears only in the expanded module list (unavailable), so it is an
    // unambiguous "the full list is open" assertion.
    await waitFor(() => expect(canvas.getByText('apbs')).toBeVisible());
  },
};

/** The Measurement wizard live: the generic panel + the pick-seam block. */
export const Active: Story = {
  decorators: [withActiveWizard],
  render: () => (
    <div style={{ maxWidth: 320 }}>
      <WizardsPanel />
    </div>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await waitFor(() =>
      expect(canvas.getByText('Delete All Measurements')).toBeVisible(),
    );
  },
};
