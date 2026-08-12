/**
 * Volume color-map editor — the real {@link VolumePanel} feature bundle.
 *
 * The `<name> - Volume Color Map Editor`: object/preset header, the ramp canvas
 * and the button row (`Get colors as script`, `Reset Data Range`, `Help`, and
 * the real-time checkbox). Unlike the launcher-fronted overlays, this panel
 * renders directly from a {@link DialogWindowSpec}, so the story shows its full
 * chrome. The stub session answers no ramp, so it draws its empty transfer
 * function — the modern theme's card treatment on a genuine editor.
 */

import type { Meta, StoryObj } from '@storybook/react-vite';
import { VolumePanel } from '@web/features/volume/VolumePanel';
import type { DialogWindowSpec } from '@web/features/dialogs/store';
import { withVolumeData } from './volumeSession';

const SPEC: DialogWindowSpec = {
  key: 'volume:map',
  kind: 'volume',
  arg: 'map',
  title: 'map - Volume Color Map Editor',
  x: 0,
  y: 0,
  width: 640,
  height: 300,
  z: 1,
  minimised: false,
};

const meta = {
  title: 'Panels/Volume',
  parameters: { layout: 'padded' },
  decorators: [withVolumeData],
} satisfies Meta<typeof VolumePanel>;

export default meta;
type Story = StoryObj<typeof meta>;

/**
 * The volume transfer-function editor over a seeded electron-density map: a
 * six-stop colour ramp, the captured 64-bin histogram, and a live named-ramp
 * list.
 */
export const Default: Story = {
  render: () => <VolumePanel spec={SPEC} />,
};
