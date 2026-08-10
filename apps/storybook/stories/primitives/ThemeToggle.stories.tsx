/**
 * ThemeToggle — the live look-switcher the shell ships in its header.
 *
 * A Radix `DropdownMenu` picks classic ⇄ modern; in the modern theme a Sun/Moon
 * button also flips light/dark. It reads the same {@link ThemeProvider} controls
 * the global Storybook decorator supplies, so it is fully live here — clicking it
 * flips Storybook itself. Flip the toolbar Theme/Appearance to compare chrome.
 */

import type { Meta, StoryObj } from '@storybook/react-vite';

import { ThemeToggle } from '@web/ui';

const meta = {
  title: 'Primitives/ThemeToggle',
  component: ThemeToggle,
  parameters: { layout: 'padded' },
} satisfies Meta<typeof ThemeToggle>;

export default meta;
type Story = StoryObj<typeof meta>;

/**
 * The toggle inside a shell-header-like `menubar` strip. This is the real
 * control the app ships: clicking it actually switches the whole Storybook
 * theme live (classic ⇄ modern, and Sun/Moon for light/dark in modern) — the
 * same provider that drives the toolbar Theme/Appearance switches.
 */
export const InMenubar: Story = {
  render: () => (
    <div
      className="menubar"
      style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '4px 8px' }}
    >
      <span style={{ opacity: 0.6, fontSize: 12 }}>Theme</span>
      <ThemeToggle />
    </div>
  ),
};
