/**
 * Tooltip — the shadcn/Radix tooltip primitive.
 *
 * Compose a `TooltipProvider` (timing/state) around a `Tooltip` root that pairs a
 * `TooltipTrigger` with the portalled, styled `TooltipContent` bubble. Flip the
 * toolbar Theme to compare classic/modern, and Appearance for light/dark.
 */

import type { Meta, StoryObj } from '@storybook/react-vite';

import { Button, Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@web/ui';

const meta = {
  title: 'Primitives/Tooltip',
  component: Tooltip,
  parameters: { layout: 'centered' },
} satisfies Meta<typeof Tooltip>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Opens on load via `defaultOpen`, so the portalled bubble is visible at rest. */
export const Open: Story = {
  render: () => (
    <TooltipProvider>
      <div style={{ padding: 64, display: 'flex', justifyContent: 'center' }}>
        <Tooltip defaultOpen>
          <TooltipTrigger asChild>
            <Button variant="extgui">Hover me</Button>
          </TooltipTrigger>
          <TooltipContent>Renders a frame, then exports the take.</TooltipContent>
        </Tooltip>
      </div>
    </TooltipProvider>
  ),
};

/** Resting until hovered; `delayDuration={0}` shows the bubble immediately. */
export const OnHover: Story = {
  render: () => (
    <TooltipProvider delayDuration={0}>
      <div style={{ padding: 64, display: 'flex', justifyContent: 'center' }}>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="extgui">Hover me</Button>
          </TooltipTrigger>
          <TooltipContent>Renders a frame, then exports the take.</TooltipContent>
        </Tooltip>
      </div>
    </TooltipProvider>
  ),
};
