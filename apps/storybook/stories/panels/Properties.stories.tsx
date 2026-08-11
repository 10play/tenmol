/**
 * Properties Inspector — the real {@link PropertiesPanel} feature bundle.
 *
 * The upstream `properties_dialog` window: a header row (Object combo, State and
 * Atom-index spins, Refresh) over the fixed four-level property tree. It renders
 * directly from a {@link DialogWindowSpec}, so the story shows its full window
 * chrome. On the stub session `get_object_list()` answers empty, so the object
 * combo is empty and the tree draws its idle sections — the modern theme's
 * floating-card treatment on a genuine inspector.
 */

import type { Meta, StoryObj } from '@storybook/react-vite';
import { PropertiesPanel } from '@web/features/properties/PropertiesPanel';
import type { DialogWindowSpec } from '@web/features/dialogs/store';

const SPEC: DialogWindowSpec = {
  key: 'properties',
  kind: 'properties',
  arg: '',
  title: 'Properties',
  x: 0,
  y: 0,
  width: 560,
  height: 520,
  z: 1,
  minimised: false,
};

const meta = {
  title: 'Panels/Properties',
  parameters: { layout: 'padded' },
} satisfies Meta<typeof PropertiesPanel>;

export default meta;
type Story = StoryObj<typeof meta>;

/** The Properties inspector window on an idle session. */
export const Default: Story = {
  render: () => <PropertiesPanel spec={SPEC} />,
};
