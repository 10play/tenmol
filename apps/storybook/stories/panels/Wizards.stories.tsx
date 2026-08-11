/**
 * Wizards panel — the real {@link WizardsPanel} feature bundle.
 *
 * The wizard launcher + generic panel renderer, mounted on the stub session.
 * With no wizard active it shows the launcher entry point — the modern theme's
 * card chrome around the genuine wizard surface.
 */

import type { Meta, StoryObj } from '@storybook/react-vite';
import { WizardsPanel } from '@web/features/wizards/WizardsPanel';
import { withPanelData } from './panelData';

const meta = {
  title: 'Panels/Wizards',
  parameters: { layout: 'padded' },
  decorators: [withPanelData],
} satisfies Meta<typeof WizardsPanel>;

export default meta;
type Story = StoryObj<typeof meta>;

/** The wizard launcher on an idle session. */
export const Default: Story = {
  render: () => <WizardsPanel />,
};
