/**
 * Colours overlay — the real {@link ColorsPanel} feature bundle.
 *
 * The whole colour system in one window: palette swatches, the colour editor,
 * spectrum, ramps and colour space, behind the floating "C" launcher the slot
 * carries until WP-14's menu bar lands. Mounted on the stub session (empty
 * palette), so it renders its genuine not-connected state — the modern theme's
 * floating-card chrome around the real control surface.
 */

import { useEffect, useRef, type ReactNode } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { ColorsPanel } from '@web/features/colors/ColorsPanel';

const meta = {
  title: 'Panels/Colors',
  parameters: { layout: 'padded' },
} satisfies Meta<typeof ColorsPanel>;

export default meta;
type Story = StoryObj<typeof meta>;

/** The floating "C" launcher at rest — the slot's collapsed entry point. */
export const Default: Story = {
  render: () => <ColorsPanel />,
};

/** Clicks the `.colors-launch` button once after mount to reveal the panel. */
function AutoOpen({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.querySelector<HTMLButtonElement>('.colors-launch')?.click();
  }, []);
  return <div ref={ref}>{children}</div>;
}

/** The expanded colours window — selection field, tab bar and palette body. */
export const Open: Story = {
  render: () => (
    <AutoOpen>
      <ColorsPanel />
    </AutoOpen>
  ),
};
