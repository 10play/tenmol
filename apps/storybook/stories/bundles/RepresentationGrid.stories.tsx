/**
 * Representation Grid — the mode picker as a grid of icon cards.
 *
 * The molecular-viewer pattern the modern theme is aiming at: a titled section
 * over a 3-column grid of rounded cards, each an icon above a short label, with
 * the active card lifted into an accent-tinted, accent-bordered state. Built
 * from the surface primitives (`Panel`) plus plain Tailwind, so the classic
 * theme shows a readable flat grid and the modern (shadcn) theme paints the
 * frosted card + accent selection. Flip the toolbar Theme / Appearance.
 */

import { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { Atom, Circle, Droplet, EyeOff, Minus, PenLine, Spline, type LucideIcon } from 'lucide-react';

import { Panel } from '@web/ui';

interface Rep {
  id: string;
  label: string;
  icon: LucideIcon;
}

const REPS: Rep[] = [
  { id: 'cartoon', label: 'Cartoon', icon: Spline },
  { id: 'stick', label: 'Stick', icon: PenLine },
  { id: 'sphere', label: 'Sphere', icon: Circle },
  { id: 'ballstick', label: 'Ball·Stick', icon: Atom },
  { id: 'line', label: 'Line', icon: Minus },
  { id: 'surface', label: 'Surface', icon: Droplet },
  { id: 'hide', label: 'Hide', icon: EyeOff },
];

/** Tiny muted uppercase section label — the modern theme's section-header idiom. */
function SectionLabel({ children }: { children: string }) {
  return (
    <div className="text-[10px] font-semibold uppercase tracking-[0.09em] text-[var(--pm-text-dim,#8b93a7)]">
      {children}
    </div>
  );
}

/** One representation card: icon over label, accent-lifted when selected. */
function RepCard({ rep, selected, onClick }: { rep: Rep; selected: boolean; onClick: () => void }) {
  const Icon = rep.icon;
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      className={[
        'group flex flex-col items-center justify-center gap-1.5 rounded-[calc(var(--sh-r-sm,9px)+2px)]',
        'border px-2 py-2.5 transition-[color,background-color,border-color,box-shadow] outline-none',
        'focus-visible:outline-2 focus-visible:outline-[var(--sh-focus-ring,rgba(99,102,241,0.4))]',
        selected
          ? 'border-[color-mix(in_srgb,var(--pm-accent,#6366f1)_50%,transparent)] bg-[var(--sh-accent-soft,rgba(99,102,241,0.14))] text-[var(--pm-accent,#6366f1)] shadow-[0_1px_2px_rgba(79,70,229,0.18)]'
          : 'border-[var(--sh-btn-border,rgba(148,163,184,0.14))] bg-[var(--sh-btn-fill,rgba(148,163,184,0.06))] text-[var(--pm-text,#dfe4ee)] hover:border-[var(--sh-btn-border-strong,rgba(148,163,184,0.24))] hover:bg-[var(--sh-btn-hover,rgba(148,163,184,0.12))]',
      ].join(' ')}
    >
      <Icon
        className="h-[18px] w-[18px]"
        strokeWidth={1.75}
        aria-hidden
      />
      <span className="text-[11px] font-medium leading-none">{rep.label}</span>
    </button>
  );
}

function RepresentationPanel() {
  const [active, setActive] = useState('cartoon');
  return (
    <Panel style={{ width: 236 }}>
      <div className="flex flex-col gap-2.5 p-3.5">
        <SectionLabel>Representation</SectionLabel>
        <div className="grid grid-cols-3 gap-2">
          {REPS.map((rep) => (
            <RepCard
              key={rep.id}
              rep={rep}
              selected={active === rep.id}
              onClick={() => setActive(rep.id)}
            />
          ))}
        </div>
      </div>
    </Panel>
  );
}

const meta = {
  title: 'Bundles/Representation Grid',
  parameters: { layout: 'padded' },
} satisfies Meta<typeof RepresentationPanel>;

export default meta;
type Story = StoryObj<typeof meta>;

/** The representation picker: a 3-col grid of icon cards, one selected. */
export const Grid: Story = {
  render: () => <RepresentationPanel />,
};
