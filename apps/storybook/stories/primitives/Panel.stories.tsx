/**
 * Panel / PanelHeader / Toolbar — the surface primitives.
 *
 * `Panel` is a plain `<div>` in the classic theme; the modern (shadcn) theme
 * layers a frosted card on the same DOM (border, radius, shadow, blur).
 * `PanelHeader` is its header strip and `Toolbar` is a horizontal band that
 * carries `role="toolbar"` by default. Flip the toolbar Theme to compare
 * classic vs. modern, and Appearance for light/dark in the modern theme.
 */

import type { Meta, StoryObj } from '@storybook/react-vite';

import { Button, Panel, PanelHeader, Toolbar } from '@web/ui';

const meta = {
  title: 'Primitives/Panel',
  component: Panel,
  parameters: { layout: 'padded' },
} satisfies Meta<typeof Panel>;

export default meta;
type Story = StoryObj<typeof meta>;

/** A bare panel: a header title over some body text. The card shape only reads in the modern theme. */
export const Basic: Story = {
  render: () => (
    <Panel style={{ width: 280 }}>
      <PanelHeader style={{ padding: '8px 12px', fontWeight: 600 }}>Inspector</PanelHeader>
      <div style={{ padding: '8px 12px', opacity: 0.8 }}>
        A surface container. In the classic theme it is a plain div; the modern theme paints a
        frosted card around the same markup.
      </div>
    </Panel>
  ),
};

/** A panel whose header sits above a Toolbar row of `extgui` controls. */
export const WithToolbar: Story = {
  render: () => (
    <Panel style={{ width: 280 }}>
      <PanelHeader style={{ padding: '8px 12px', fontWeight: 600 }}>Render</PanelHeader>
      <Toolbar style={{ display: 'flex', gap: 8, padding: '8px 12px' }}>
        <Button variant="extgui">Draft</Button>
        <Button variant="extgui">Final</Button>
        <Button variant="extgui">Denoise</Button>
      </Toolbar>
      <div style={{ padding: '8px 12px', opacity: 0.8 }}>Pick a quality preset, then render.</div>
    </Panel>
  ),
};

/** Standalone Toolbar bands (each `role="toolbar"`) — the row on its own, without a panel around it. */
export const Toolbars: Story = {
  render: () => (
    <div style={{ display: 'grid', gap: 12 }}>
      <Toolbar style={{ display: 'flex', gap: 8 }}>
        <Button variant="extgui">Open</Button>
        <Button variant="extgui">Save</Button>
        <Button variant="extgui">Export</Button>
      </Toolbar>
      <Toolbar style={{ display: 'flex', gap: 8 }}>
        <Button variant="extgui">Cut</Button>
        <Button variant="extgui">Copy</Button>
        <Button variant="extgui" disabled>
          Paste
        </Button>
      </Toolbar>
    </div>
  ),
};

/** Several panels side by side so the classic (flat) vs. modern (card) treatment is obvious at a glance. */
export const Gallery: Story = {
  render: () => (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, alignItems: 'flex-start' }}>
      <Panel style={{ width: 280 }}>
        <PanelHeader style={{ padding: '8px 12px', fontWeight: 600 }}>Header only</PanelHeader>
      </Panel>

      <Panel style={{ width: 280 }}>
        <PanelHeader style={{ padding: '8px 12px', fontWeight: 600 }}>With body</PanelHeader>
        <div style={{ padding: '8px 12px', opacity: 0.8 }}>Body text inside the surface.</div>
      </Panel>

      <Panel style={{ width: 280 }}>
        <PanelHeader style={{ padding: '8px 12px', fontWeight: 600 }}>With toolbar</PanelHeader>
        <Toolbar style={{ display: 'flex', gap: 8, padding: '8px 12px' }}>
          <Button variant="extgui">One</Button>
          <Button variant="extgui">Two</Button>
        </Toolbar>
      </Panel>
    </div>
  ),
};
