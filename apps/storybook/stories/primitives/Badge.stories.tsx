/**
 * Badge — a small status pill (`<span>`) for todo markers, ticket ids and counts.
 *
 * Badge has no built-in variants: it's a bare styled span, and status is conveyed
 * by className tokens the app already ships. The classic theme paints a squared
 * pill; the modern (shadcn) theme rounds it. Flip the toolbar Theme to compare,
 * and Appearance for light/dark in the modern theme.
 */

import type { Meta, StoryObj } from '@storybook/react-vite';

import { Badge } from '@web/ui';

const meta = {
  title: 'Primitives/Badge',
  component: Badge,
  parameters: { layout: 'padded' },
  args: {
    children: 'TODO',
  },
  argTypes: {
    children: { control: 'text' },
  },
} satisfies Meta<typeof Badge>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Interactive single badge — drive the label from Controls. */
export const Playground: Story = {};

/** Plain badges carrying only their text: a marker, a ticket id, a count. */
export const Default: Story = {
  render: () => (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'center' }}>
      <Badge>TODO</Badge>
      <Badge>WP-20</Badge>
      <Badge>3</Badge>
    </div>
  ),
};

/**
 * The console's feedback-line classes tint a badge to signal severity. These
 * classes live in features/console/console.css; the badge just borrows them.
 */
export const StatusLines: Story = {
  render: () => (
    <div style={{ display: 'grid', gap: 12 }}>
      {(
        [
          ['info', 'feedback__line--info'],
          ['warning', 'feedback__line--warning'],
          ['error', 'feedback__line--error'],
          ['prompt', 'feedback__line--prompt'],
        ] as const
      ).map(([label, className]) => (
        <div key={className} style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
          <span style={{ width: 90, opacity: 0.6, fontSize: 12 }}>{label}</span>
          <Badge className={className}>{label}</Badge>
        </div>
      ))}
    </div>
  ),
};

/** A wrap row of assorted badges — labels, ids, counts and tinted statuses together. */
export const Gallery: Story = {
  render: () => (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
      <Badge>TODO</Badge>
      <Badge>WIP</Badge>
      <Badge>WP-20</Badge>
      <Badge>3</Badge>
      <Badge>42</Badge>
      <Badge className="feedback__line--info">info</Badge>
      <Badge className="feedback__line--warning">warning</Badge>
      <Badge className="feedback__line--error">error</Badge>
      <Badge className="feedback__line--prompt">prompt</Badge>
      <Badge>not installed</Badge>
    </div>
  ),
};
