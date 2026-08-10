/**
 * Overlay Panel — a floating card composed from surface primitives.
 *
 * Stacks `Panel` > `PanelHeader` + body + `Toolbar` to show the three surfaces
 * a real overlay uses: a titled header with a close affordance, a content body,
 * and a footer band of actions. The classic theme paints a plain bordered
 * panel; the modern (shadcn) theme upgrades the same DOM into a frosted card
 * (border, radius, shadow, backdrop blur). Flip the toolbar Theme to compare,
 * and Appearance for light/dark.
 */

import type { Meta, StoryObj } from '@storybook/react-vite';
import { X } from 'lucide-react';

import { Button, IconButton, Panel, PanelHeader, Toolbar } from '@web/ui';

const meta = {
  title: 'Bundles/Overlay Panel',
  component: Panel,
  parameters: { layout: 'padded' },
} satisfies Meta<typeof Panel>;

export default meta;
type Story = StoryObj<typeof meta>;

/**
 * The overlay panel, shown in flow. Real overlay panels bring their own
 * absolute positioning (they decide WHERE they render); here it sits in the
 * document flow so the surface treatment is what's on display.
 */
export const Panel_: Story = {
  name: 'Panel',
  render: () => (
    <Panel style={{ width: 300 }}>
      <PanelHeader
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: 12,
          padding: 12,
        }}
      >
        <span style={{ fontWeight: 600 }}>Overlay Panel</span>
        <IconButton icon={X} title="Close">
          close
        </IconButton>
      </PanelHeader>
      <p style={{ padding: '0 12px', margin: '4px 0 12px', opacity: 0.8, fontSize: 13 }}>
        Placeholder content for the floating panel body. Whatever a feature drops
        here scrolls or wraps inside the surface.
      </p>
      <Toolbar style={{ display: 'flex', gap: 8, padding: 12 }}>
        <Button variant="extgui">Cancel</Button>
        <Button variant="extgui">Confirm</Button>
      </Toolbar>
    </Panel>
  ),
};
