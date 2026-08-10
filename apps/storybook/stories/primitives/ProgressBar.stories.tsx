/**
 * ProgressBar — the determinate bar from the quick-button progress row.
 *
 * It renders `role="progressbar"` with the legacy `progressbar` /
 * `progressbar__fill` DOM and an inline `style.width` on the fill. The classic
 * theme paints from those BEM classes; the modern theme layers Tailwind on the
 * same DOM. Flip the toolbar Theme to compare, and Appearance for light/dark.
 */

import type { Meta, StoryObj } from '@storybook/react-vite';

import { Button, ProgressBar } from '@web/ui';

const meta = {
  title: 'Primitives/ProgressBar',
  component: ProgressBar,
  parameters: { layout: 'padded' },
  args: { value: 35 },
  argTypes: {
    value: { control: { type: 'range', min: 0, max: 100 } },
  },
} satisfies Meta<typeof ProgressBar>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Interactive single bar — drag the `value` range Control to fill it. */
export const Playground: Story = {
  render: (args) => (
    <div style={{ width: 240 }}>
      <ProgressBar {...args} />
    </div>
  ),
};

/** A column of bars at the canonical fill levels, each labeled with its percent. */
export const Steps: Story = {
  render: () => (
    <div style={{ display: 'grid', gap: 12, width: 240 }}>
      {[0, 35, 70, 100].map((value) => (
        <div key={value} style={{ display: 'grid', gap: 4 }}>
          <span style={{ opacity: 0.6, fontSize: 12 }}>{value}%</span>
          <ProgressBar value={value} />
        </div>
      ))}
    </div>
  ),
};

/** PyMOL's progress + abort row: a filling bar beside the quick-button Abort. */
export const AbortRow: Story = {
  render: () => (
    <div style={{ display: 'flex', gap: 8, alignItems: 'center', width: 320 }}>
      <div style={{ flex: 1 }}>
        <ProgressBar value={35} />
      </div>
      <Button variant="quick" className="quickbutton--abort">
        Abort
      </Button>
    </div>
  ),
};
