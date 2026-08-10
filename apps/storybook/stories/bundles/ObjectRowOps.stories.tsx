/**
 * Object Row Ops — the A/S/H/L/C/M op cluster from the object panel.
 *
 * Each object row ends in a `.objrow__ops` group of six single-letter buttons.
 * The app writes them as `<button class="objrow__op objrow__op--{letter}">`;
 * here we compose the same DOM from the `op` Button variant (which emits the
 * base `objrow__op` class) plus a per-op modifier class that carries the tint.
 *
 * Letter map: A=Action, S=Show, H=Hide, L=Label, C=Color, M=Movie/menu.
 *
 * The tint colours live in the objects/global stylesheets that ship with the
 * app; if they don't paint inside Storybook that's fine — the row structure is
 * the point. Flip the toolbar Theme (classic <-> shadcn) and Appearance to
 * compare.
 */

import type { Meta, StoryObj } from '@storybook/react-vite';

import { Button } from '@web/ui';

/** The six ops, in panel order. */
const OPS = ['A', 'S', 'H', 'L', 'C', 'M'] as const;

/** The op cluster: six letter buttons wrapped in `.objrow__ops`. */
function OpGroup() {
  return (
    <div className="objrow__ops">
      {OPS.map((letter) => (
        <Button key={letter} variant="op" className={`objrow__op--${letter.toLowerCase()}`}>
          {letter}
        </Button>
      ))}
    </div>
  );
}

/** One object row: a name label followed by the op cluster. */
function ObjRow({ name }: { name: string }) {
  return (
    <div className="objrow" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <span className="objrow__name" style={{ flex: 1 }}>
        {name}
      </span>
      <OpGroup />
    </div>
  );
}

const meta = {
  title: 'Bundles/Object Row Ops',
  parameters: { layout: 'padded' },
} satisfies Meta<typeof OpGroup>;

export default meta;
type Story = StoryObj<typeof meta>;

/** A single object row: a name label plus the six-button op cluster. */
export const Ops: Story = {
  render: () => (
    <div className="objects" style={{ width: 240 }}>
      <ObjRow name="camera" />
    </div>
  ),
};

/** Three stacked rows, reading like a mini object list in the panel. */
export const Rows: Story = {
  render: () => (
    <div className="objects" style={{ width: 240 }}>
      <ObjRow name="camera" />
      <ObjRow name="ground" />
      <ObjRow name="light" />
    </div>
  ),
};
