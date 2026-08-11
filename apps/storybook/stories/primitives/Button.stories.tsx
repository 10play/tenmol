/**
 * Button / IconButton / ToggleButton — the most-reused atoms.
 *
 * The `variant` picks the legacy BEM base class the button stands in for; the
 * classic theme paints from that class, the modern theme layers Tailwind on top
 * of the same DOM. Flip the toolbar Theme to compare, and Appearance for
 * light/dark in the modern theme.
 */

import type { Meta, StoryObj } from '@storybook/react-vite';
import { Ban, Camera, Play, Search, SkipBack, Trash2 } from 'lucide-react';

import { Button, IconButton, ToggleButton, type ButtonVariant } from '@web/ui';

const VARIANTS: ButtonVariant[] = [
  'bare',
  'quick',
  'menubar',
  'control',
  'extgui',
  'launcher',
  'consoleBar',
  'op',
];

const meta = {
  title: 'Primitives/Button',
  component: Button,
  parameters: { layout: 'padded' },
  args: {
    children: 'Button',
    variant: 'quick',
    disabled: false,
  },
  argTypes: {
    variant: { control: 'select', options: VARIANTS },
    disabled: { control: 'boolean' },
    children: { control: 'text' },
  },
} satisfies Meta<typeof Button>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Interactive single button — drive `variant`/`disabled`/label from Controls. */
export const Playground: Story = {};

/** Every variant side by side, in its resting state. */
export const AllVariants: Story = {
  render: () => (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'center' }}>
      {VARIANTS.map((variant) => (
        <Button key={variant} variant={variant}>
          {variant}
        </Button>
      ))}
    </div>
  ),
};

/** Resting vs. disabled for each variant. */
export const States: Story = {
  render: () => (
    <div style={{ display: 'grid', gap: 12 }}>
      {VARIANTS.map((variant) => (
        <div key={variant} style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
          <span style={{ width: 90, opacity: 0.6, fontSize: 12 }}>{variant}</span>
          <Button variant={variant}>enabled</Button>
          <Button variant={variant} disabled>
            disabled
          </Button>
        </div>
      ))}
    </div>
  ),
};

/** Icons render only in the modern theme; the text label always stays in the DOM. */
export const WithIcon: Story = {
  render: () => (
    <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
      <Button variant="extgui" icon={Camera}>
        Ray
      </Button>
      <Button variant="quick" icon={Play}>
        Play
      </Button>
      <IconButton variant="control" icon={SkipBack} title="Rewind">
        rewind
      </IconButton>
      <IconButton variant="quick" icon={Ban} title="Abort">
        abort
      </IconButton>
    </div>
  ),
};

/**
 * Colour intent via `tone` (modern theme only): the solid indigo `accent` CTA
 * outranks quiet `default` secondaries, with `danger` for destructive actions.
 * In the classic theme every tone renders as the same PyMOL button.
 */
export const Hierarchy: Story = {
  render: () => (
    <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
      <Button variant="bare" tone="accent" icon={Search}>
        Fetch
      </Button>
      <Button variant="bare">Cancel</Button>
      <Button variant="menubar">Ghost</Button>
      <Button variant="bare" tone="danger" icon={Trash2}>
        Delete
      </Button>
    </div>
  ),
};

/** Two-state button: pressed mirrors `aria-pressed` + the legacy `is-on` class. */
export const Toggle: Story = {
  render: () => (
    <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
      <ToggleButton variant="extgui">off</ToggleButton>
      <ToggleButton variant="extgui" pressed>
        on
      </ToggleButton>
      <ToggleButton variant="quick" pressed>
        active
      </ToggleButton>
    </div>
  ),
};
