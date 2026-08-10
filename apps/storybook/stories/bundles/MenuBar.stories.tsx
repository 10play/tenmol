/**
 * Menu Bar — the shell-header menu strip, composed from primitives.
 *
 * This is not the real feature MenuBar; it's a hand-composed strip of
 * `Button variant="menubar"` items with the live {@link ThemeToggle} pushed to
 * the right. In the modern theme the items read as ghost buttons; in classic
 * they're the flat PyMOL menu entries. Flip the toolbar Theme to compare, and
 * Appearance for light/dark in the modern theme.
 */

import type { Meta, StoryObj } from '@storybook/react-vite';

import { Button, ThemeToggle } from '@web/ui';

const ITEMS = ['File', 'Edit', 'View', 'Movie', 'Wizard', 'Help'];

const meta = {
  title: 'Bundles/Menu Bar',
  parameters: { layout: 'padded' },
} satisfies Meta<typeof ThemeToggle>;

export default meta;
type Story = StoryObj<typeof meta>;

/**
 * The menu bar strip: menubar buttons on the left, the real theme switcher on
 * the right. In the app each item opens a menu — here they demonstrate the
 * menubar button styling across themes, while the right side carries the live
 * ThemeToggle.
 */
export const Strip: Story = {
  render: () => (
    <div className="menubar" style={{ display: 'flex', gap: 4, alignItems: 'center', padding: '2px 6px' }}>
      {ITEMS.map((item) => (
        <Button key={item} variant="menubar">
          {item}
        </Button>
      ))}
      <div style={{ marginLeft: 'auto', display: 'flex', gap: 4, alignItems: 'center' }}>
        <ThemeToggle />
      </div>
    </div>
  ),
};
