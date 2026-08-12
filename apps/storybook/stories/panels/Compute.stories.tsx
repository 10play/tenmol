/**
 * Compute panel — the real {@link ComputePanel} feature bundle.
 *
 * The `pymol.util` helpers (WP-24 / B9) that run against a selection and read a
 * number back: each metric gets a row with its params and a result column, and
 * the mutating `protein_vacuum_esp` sits behind a confirm step.
 *
 * The panel computes nothing on mount — a result cell fills only when its button
 * is pressed. So `withComputeData` supplies the values a live engine returns, and
 * the {@link Populated} wrapper presses a representative handful of helpers from a
 * mount effect (including the SASA table, which comes up behind its confirm step),
 * so the panel paints with real numbers, a selection result and the per-residue
 * exposure bars — the modern card chrome around a genuinely connected surface.
 */

import { useEffect, useRef } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { ComputePanel } from '@web/features/compute/ComputePanel';

import { withComputeData } from './computeSession';

const meta = {
  title: 'Panels/Compute',
  parameters: { layout: 'padded' },
  decorators: [withComputeData],
} satisfies Meta<typeof ComputePanel>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Press a `.compute__btn` by its exact visible label, if present. */
function pressByLabel(root: HTMLElement, label: string): void {
  const btn = Array.from(root.querySelectorAll<HTMLButtonElement>('.compute__btn')).find(
    (b) => b.textContent?.trim() === label,
  );
  btn?.click();
}

/**
 * The panel with a representative set of results filled in.
 *
 * Drives the real buttons (their own `onClick` runs through the mock session)
 * rather than faking state, so what shows is exactly what a click produces:
 * scalar numbers, a "selection made" line, a "done" side-effect, and the SASA
 * table — which requires acknowledging its overwrite-confirm first.
 */
function Populated() {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const root = ref.current;
    if (!root) return;
    for (const label of [
      'Molecular surface area',
      'Solvent-accessible surface area',
      'Mass',
      'Sum of formal charges',
      'Sum of partial charges',
      'Find surface residues',
      'Phi / psi of a residue',
      'Label chains',
    ]) {
      pressByLabel(root, label);
    }
    // The SASA table writes onto atoms, so its button opens the confirm step;
    // run it on the next tick, once that dialog has rendered.
    pressByLabel(root, 'Relative SASA per residue');
    const t = window.setTimeout(() => {
      if (root) pressByLabel(root, 'Overwrite and run');
    }, 0);
    return () => window.clearTimeout(t);
  }, []);
  return (
    <div ref={ref}>
      <ComputePanel />
    </div>
  );
}

/** The compute metrics with real results filled in. */
export const Default: Story = {
  render: () => <Populated />,
};
