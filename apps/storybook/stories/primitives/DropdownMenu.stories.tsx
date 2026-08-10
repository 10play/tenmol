/**
 * DropdownMenu — the Radix/shadcn menu used for NEW shell controls.
 *
 * Unlike the native atoms, this is a genuine Radix menu portalled to the
 * document root and styled with the bridged Tailwind tokens, so it looks
 * "modern" in both themes. Radix menus are closed by default, so these stories
 * force them visible (`defaultOpen`) or let the reviewer click the trigger.
 * Flip the toolbar Theme/Appearance to compare — the portal renders under the
 * theme ancestor, so tokens still resolve.
 */

import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';

import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuChevron,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@web/ui';

const meta = {
  title: 'Primitives/DropdownMenu',
  component: DropdownMenu,
  parameters: { layout: 'padded' },
} satisfies Meta<typeof DropdownMenu>;

export default meta;
type Story = StoryObj<typeof meta>;

/** The menu contents, shared by both stories; checkbox rows keep local state. */
function MenuBody() {
  const [showGrid, setShowGrid] = useState(true);
  const [showAxes, setShowAxes] = useState(false);
  return (
    <DropdownMenuContent>
      <DropdownMenuLabel>View</DropdownMenuLabel>
      <DropdownMenuSeparator />
      <DropdownMenuItem>Reset camera</DropdownMenuItem>
      <DropdownMenuItem>Zoom to selection</DropdownMenuItem>
      <DropdownMenuItem>
        Presets
        <DropdownMenuChevron />
      </DropdownMenuItem>
      <DropdownMenuSeparator />
      <DropdownMenuCheckboxItem
        checked={showGrid}
        onCheckedChange={(v) => setShowGrid(v === true)}
      >
        Show grid
      </DropdownMenuCheckboxItem>
      <DropdownMenuCheckboxItem
        checked={showAxes}
        onCheckedChange={(v) => setShowAxes(v === true)}
      >
        Show axes
      </DropdownMenuCheckboxItem>
    </DropdownMenuContent>
  );
}

/**
 * Forced open with `defaultOpen` so the portalled Content is visible on load —
 * label, items, a submenu-affordance row (chevron), and two checkbox rows
 * (grid checked, axes unchecked).
 */
export const Open: Story = {
  render: () => (
    <DropdownMenu defaultOpen>
      <DropdownMenuTrigger asChild>
        <button className="menubar__item">Menu</button>
      </DropdownMenuTrigger>
      <MenuBody />
    </DropdownMenu>
  ),
};

/** The same menu closed by default — click the trigger to open the portal. */
export const Triggered: Story = {
  render: () => (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button className="menubar__item">Menu</button>
      </DropdownMenuTrigger>
      <MenuBody />
    </DropdownMenu>
  ),
};
