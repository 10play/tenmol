/**
 * StatusBar — the connected status strip from the bottom of the app.
 *
 * The real shell component (`shell/StatusBar`) reports the socket phase, engine
 * state, live progress, object count, and GL renderer, left to right. It reads
 * `useSession`/`useStore` for the connection/objects/feedback stores, which the
 * global Storybook decorators satisfy with a stub Session — no live bridge.
 *
 * Flip the toolbar Theme to compare classic (the plain corner strip) against
 * modern, and Appearance for light/dark in the modern theme.
 */

import type { Meta, StoryObj } from '@storybook/react-vite';

import { StatusBar } from '@web/shell/StatusBar';

const meta = {
  title: 'Bundles/Status Bar',
  component: StatusBar,
  parameters: { layout: 'padded' },
} satisfies Meta<typeof StatusBar>;

export default meta;
type Story = StoryObj<typeof meta>;

/**
 * The status bar pinned to a full-width container, exactly as it sits across the
 * bottom of the app.
 *
 * The connection text reflects the stub session state, so it reads whatever
 * phase the stub reports rather than a live socket. In the modern theme the
 * right side also hosts the inline overlay-panel launcher buttons; in classic
 * it is the plain strip with no launchers.
 */
export const Default: Story = {
  render: () => (
    <div style={{ width: '100%' }}>
      <StatusBar />
    </div>
  ),
};
