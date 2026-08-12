/**
 * Coloring Swatches — the colour-scheme list as gradient pills.
 *
 * A vertical list of selectable rows, each pairing a rounded-full gradient
 * swatch with a label; the active row lifts into a bordered, faintly-elevated
 * pill. This is the second half of a molecular viewer's left rail (the first is
 * the Representation grid). Built on the `Panel` primitive plus plain Tailwind
 * and literal gradients (theme-agnostic), so both themes render cleanly.
 */

import { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { ArrowUpRight } from 'lucide-react';

import { Panel } from '@web/ui';

interface Scheme {
  id: string;
  label: string;
  /** A CSS gradient painted into the swatch pill. */
  swatch: string;
  /** Schemes that open their own sub-options carry an out-link affordance. */
  expandable?: boolean;
}

const SCHEMES: Scheme[] = [
  { id: 'spectrum', label: 'Spectrum', swatch: 'linear-gradient(90deg,#6d5efc,#22d3ee,#34d399,#facc15,#fb7185)' },
  { id: 'chain', label: 'Chain', swatch: 'linear-gradient(90deg,#f97316,#22c55e,#3b82f6)' },
  { id: 'ss', label: 'Secondary structure', swatch: 'linear-gradient(90deg,#f43f5e,#f59e0b,#e5e7eb)' },
  { id: 'element', label: 'Element (CPK)', swatch: 'linear-gradient(90deg,#94a3b8,#ef4444,#3b82f6)' },
  { id: 'bfactor', label: 'B-factor', swatch: 'linear-gradient(90deg,#2563eb,#22d3ee,#fca5a5,#dc2626)' },
  { id: 'hydro', label: 'Hydrophobicity', swatch: 'linear-gradient(90deg,#f2c14e,#e2e8f0,#4f46e5)', expandable: true },
  { id: 'charge', label: 'Charge', swatch: 'linear-gradient(90deg,#ef4444,#e5e7eb,#3b82f6)' },
  { id: 'residue', label: 'By residue', swatch: 'linear-gradient(90deg,#10b981,#6366f1,#f472b6)', expandable: true },
  { id: 'solid', label: 'Solid color', swatch: 'linear-gradient(90deg,#5b57f0,#6d67f2)', expandable: true },
];

function SectionLabel({ children }: { children: string }) {
  return (
    <div className="text-[10px] font-semibold uppercase tracking-[0.09em] text-[var(--pm-text-dim,#8b93a7)]">
      {children}
    </div>
  );
}

/** One colour-scheme row: gradient pill + label, bordered-elevated when active. */
function SchemeRow({ s, selected, onClick }: { s: Scheme; selected: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      className={[
        'flex w-full items-center gap-2.5 rounded-full border px-2 py-1 text-left transition-[color,background-color,border-color,box-shadow] outline-none',
        'focus-visible:outline-2 focus-visible:outline-[var(--sh-focus-ring,rgba(99,102,241,0.4))]',
        selected
          ? 'border-[var(--sh-btn-border-strong,rgba(148,163,184,0.24))] bg-[var(--pm-panel-alt,rgba(148,163,184,0.08))] shadow-[0_1px_2px_rgba(15,23,42,0.08)]'
          : 'border-transparent hover:bg-[var(--sh-btn-hover,rgba(148,163,184,0.1))]',
      ].join(' ')}
    >
      <span
        className="h-[18px] w-11 flex-none rounded-full ring-1 ring-black/5"
        style={{ background: s.swatch }}
        aria-hidden
      />
      <span
        className={[
          'flex-1 truncate text-[12.5px]',
          selected
            ? 'font-semibold text-[var(--pm-text-bright,#f5f7fb)]'
            : 'text-[var(--pm-text,#dfe4ee)]',
        ].join(' ')}
      >
        {s.label}
      </span>
      {s.expandable && (
        <ArrowUpRight
          className="h-3.5 w-3.5 flex-none text-[var(--pm-text-dim,#8b93a7)]"
          strokeWidth={2}
          aria-hidden
        />
      )}
    </button>
  );
}

function ColoringPanel() {
  const [active, setActive] = useState('spectrum');
  return (
    <Panel style={{ width: 252 }}>
      <div className="flex flex-col gap-2 p-3.5">
        <SectionLabel>Coloring</SectionLabel>
        <div className="flex flex-col gap-0.5">
          {SCHEMES.map((s) => (
            <SchemeRow key={s.id} s={s} selected={active === s.id} onClick={() => setActive(s.id)} />
          ))}
        </div>
      </div>
    </Panel>
  );
}

const meta = {
  title: 'Bundles/Coloring Swatches',
  parameters: { layout: 'padded' },
} satisfies Meta<typeof ColoringPanel>;

export default meta;
type Story = StoryObj<typeof meta>;

/** The colour-scheme list: gradient swatch pills, one selected. */
export const Swatches: Story = {
  render: () => <ColoringPanel />,
};
