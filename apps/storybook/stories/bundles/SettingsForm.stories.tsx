/**
 * Settings Form — a settings dialog composed entirely from primitives.
 *
 * This is the "bundle" showcase: a `Panel` + `PanelHeader` wrapping labeled rows
 * of `TextInput`, `Select`, `Slider`, `Checkbox`, `Switch`, and a `Button` footer.
 * Every control is native and uncontrolled (`defaultValue`/`defaultChecked`), so
 * the whole thing renders without a bridge. Flip the toolbar Theme to compare the
 * classic panel against the shadcn card, and Appearance for light/dark in modern.
 */

import type { Meta, StoryObj } from '@storybook/react-vite';
import type { ReactNode } from 'react';

import {
  Button,
  Checkbox,
  Panel,
  PanelHeader,
  Select,
  Slider,
  Switch,
  TextInput,
} from '@web/ui';

const meta = {
  title: 'Bundles/Settings Form',
  parameters: { layout: 'padded' },
} satisfies Meta<typeof Panel>;

export default meta;
type Story = StoryObj<typeof meta>;

/** One labeled row: a fixed label column beside its control. */
function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
      <span style={{ width: 96, flexShrink: 0, fontSize: 12, opacity: 0.7 }}>{label}</span>
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 8 }}>{children}</div>
    </div>
  );
}

/**
 * The whole settings dialog: a 320px panel with a header and a stack of rows,
 * closed by a bare Cancel and a primary (extgui) Apply. All inputs are
 * uncontrolled, so this renders as a static, real-looking settings surface.
 */
export const Default: Story = {
  render: () => (
    <Panel style={{ width: 320 }}>
      <PanelHeader style={{ padding: '8px 12px', fontWeight: 600 }}>Ray settings</PanelHeader>
      <div style={{ display: 'grid', gap: 12, padding: 12 }}>
        <Row label="Output name">
          <TextInput defaultValue="render.png" style={{ flex: 1 }} />
        </Row>

        <Row label="Renderer">
          <Select defaultValue="ray" style={{ flex: 1 }}>
            <option value="ray">Ray tracer</option>
            <option value="draw">Draw (OpenGL)</option>
            <option value="povray">POV-Ray</option>
          </Select>
        </Row>

        <Row label="Antialias">
          <Slider min={0} max={4} step={1} defaultValue={2} style={{ flex: 1 }} />
          <span style={{ width: 16, textAlign: 'right', fontSize: 12, opacity: 0.7 }}>2</span>
        </Row>

        <Row label="Depth cue">
          <Checkbox defaultChecked />
        </Row>

        <Row label="Orthoscopic">
          <Switch />
        </Row>

        <div
          style={{
            display: 'flex',
            justifyContent: 'flex-end',
            gap: 8,
            marginTop: 4,
            paddingTop: 12,
            borderTop: '1px solid var(--line, rgba(128,128,128,0.25))',
          }}
        >
          <Button variant="bare">Cancel</Button>
          <Button variant="extgui">Apply</Button>
        </div>
      </div>
    </Panel>
  ),
};
