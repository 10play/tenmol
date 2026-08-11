/**
 * Compute panel — the real {@link ComputePanel} feature bundle.
 *
 * The `pymol.util` helpers (WP-24 / B9) that run against a selection and read a
 * number back: each metric gets a row with its params and a result column, and
 * the mutating `protein_vacuum_esp` sits behind a confirm step. Mounted on the
 * stub session, which never returns a value, so the rows show their default
 * inputs and empty results — the modern theme's card chrome around a genuine,
 * connected compute surface.
 */

import type { Meta, StoryObj } from '@storybook/react-vite';
import { ComputePanel } from '@web/features/compute/ComputePanel';

const meta = {
  title: 'Panels/Compute',
  parameters: { layout: 'padded' },
} satisfies Meta<typeof ComputePanel>;

export default meta;
type Story = StoryObj<typeof meta>;

/** The compute metric rows at rest on an idle session. */
export const Default: Story = {
  render: () => <ComputePanel />,
};
