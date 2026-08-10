/**
 * Form controls — `Select`, `Checkbox`, `Switch`, `Slider`.
 *
 * These stay NATIVE elements in both themes on purpose: the classic theme paints
 * the raw browser control, the modern (shadcn) theme restyles the very same
 * `<select>` / `<input type=checkbox|range>` with pure CSS off `data-slot`. Value,
 * keyboard and event behaviour are identical either way. Flip the toolbar Theme to
 * compare, and Appearance for light/dark in the modern theme.
 *
 * Every story here is uncontrolled (`defaultValue` / `defaultChecked`), so no React
 * state is needed — the reviewer can still click and drag to feel the behaviour.
 */

import type { CSSProperties } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';

import { Checkbox, Select, Slider, Switch } from '@web/ui';

const meta = {
  title: 'Primitives/Form',
  parameters: { layout: 'padded' },
} satisfies Meta<typeof Select>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Shared label row so each control sits next to a caption. */
const labelStyle: CSSProperties = {
  display: 'flex',
  gap: 8,
  alignItems: 'center',
  fontSize: 13,
};

/** A `<select>` with several options: resting, a preselected value, and disabled. */
export const Selects: Story = {
  render: () => (
    <div style={{ display: 'grid', gap: 16, maxWidth: 320 }}>
      <label style={labelStyle}>
        <span style={{ width: 90, opacity: 0.6 }}>default</span>
        <Select defaultValue="cycles">
          <option value="cycles">Cycles</option>
          <option value="eevee">EEVEE</option>
          <option value="workbench">Workbench</option>
        </Select>
      </label>
      <label style={labelStyle}>
        <span style={{ width: 90, opacity: 0.6 }}>preselected</span>
        <Select defaultValue="eevee">
          <option value="cycles">Cycles</option>
          <option value="eevee">EEVEE</option>
          <option value="workbench">Workbench</option>
        </Select>
      </label>
      <label style={labelStyle}>
        <span style={{ width: 90, opacity: 0.6 }}>disabled</span>
        <Select defaultValue="cycles" disabled>
          <option value="cycles">Cycles</option>
          <option value="eevee">EEVEE</option>
        </Select>
      </label>
    </div>
  ),
};

/** Checkbox: unchecked, checked (`defaultChecked`), and disabled — each labelled. */
export const Checkboxes: Story = {
  render: () => (
    <div style={{ display: 'grid', gap: 12 }}>
      <label style={labelStyle}>
        <Checkbox />
        <span>Unchecked</span>
      </label>
      <label style={labelStyle}>
        <Checkbox defaultChecked />
        <span>Checked</span>
      </label>
      <label style={{ ...labelStyle, opacity: 0.6 }}>
        <Checkbox defaultChecked disabled />
        <span>Disabled</span>
      </label>
    </div>
  ),
};

/** Switch (a checkbox with `role=switch`): off, on, and disabled — each labelled. */
export const Switches: Story = {
  render: () => (
    <div style={{ display: 'grid', gap: 12 }}>
      <label style={labelStyle}>
        <Switch />
        <span>Off</span>
      </label>
      <label style={labelStyle}>
        <Switch defaultChecked />
        <span>On</span>
      </label>
      <label style={{ ...labelStyle, opacity: 0.6 }}>
        <Switch defaultChecked disabled />
        <span>Disabled</span>
      </label>
    </div>
  ),
};

/** Range sliders at a couple of default positions plus a disabled one. */
export const Sliders: Story = {
  render: () => (
    <div style={{ display: 'grid', gap: 16, maxWidth: 320 }}>
      <label style={{ ...labelStyle, alignItems: 'center' }}>
        <span style={{ width: 70, opacity: 0.6 }}>25%</span>
        <Slider min={0} max={100} step={1} defaultValue={25} />
      </label>
      <label style={{ ...labelStyle, alignItems: 'center' }}>
        <span style={{ width: 70, opacity: 0.6 }}>75%</span>
        <Slider min={0} max={100} step={1} defaultValue={75} />
      </label>
      <label style={{ ...labelStyle, alignItems: 'center', opacity: 0.6 }}>
        <span style={{ width: 70, opacity: 0.6 }}>disabled</span>
        <Slider min={0} max={100} step={5} defaultValue={50} disabled />
      </label>
    </div>
  ),
};

/** One row combining every control, so the modern restyle reads as a set. */
export const AllControls: Story = {
  render: () => (
    <div style={{ display: 'flex', gap: 24, alignItems: 'center', flexWrap: 'wrap' }}>
      <Select defaultValue="eevee">
        <option value="cycles">Cycles</option>
        <option value="eevee">EEVEE</option>
        <option value="workbench">Workbench</option>
      </Select>
      <label style={labelStyle}>
        <Checkbox defaultChecked />
        <span>Overlays</span>
      </label>
      <label style={labelStyle}>
        <Switch defaultChecked />
        <span>Snap</span>
      </label>
      <label style={labelStyle}>
        <span style={{ opacity: 0.6 }}>Zoom</span>
        <Slider min={0} max={100} step={1} defaultValue={60} />
      </label>
    </div>
  ),
};
