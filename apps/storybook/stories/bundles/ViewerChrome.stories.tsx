/**
 * Viewer Chrome — the whole modern layout, assembled.
 *
 * A static mock of the molecular-viewer shell the modern theme is designed for:
 * a floating top toolbar, a left rail (representation grid + colour swatches), a
 * centre canvas placeholder, and a right rail (objects & selections). Nothing
 * here is wired to a session — it exists so the design language reads as ONE
 * system (floating frosted cards on the gradient stage, indigo accent, tiny
 * uppercase section labels). Flip the toolbar Theme / Appearance to compare.
 */

import { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import {
  ArrowUpRight,
  Atom,
  Boxes,
  Camera,
  Circle,
  Contrast,
  Droplet,
  EyeOff,
  GitCompareArrows,
  Info,
  Layers,
  Maximize2,
  Menu,
  Minus,
  MousePointerClick,
  PenLine,
  Ruler,
  Save,
  Search,
  Sparkles,
  Spline,
  Upload,
  type LucideIcon,
} from 'lucide-react';

import { Button, IconButton, Panel, TextInput } from '@web/ui';

/* ---- shared idioms ------------------------------------------------- */

function SectionLabel({ children }: { children: string }) {
  return (
    <div className="text-[10px] font-semibold uppercase tracking-[0.09em] text-[var(--pm-text-dim,#8b93a7)]">
      {children}
    </div>
  );
}

/** A circular ghost icon button — the top-bar's trailing utilities. */
function RoundIcon({ icon, label }: { icon: LucideIcon; label: string }) {
  return (
    <IconButton
      icon={icon}
      variant="control"
      title={label}
      className="h-8 w-8 rounded-full border border-[var(--sh-btn-border,rgba(148,163,184,0.14))] text-[var(--pm-text-dim,#8b93a7)] hover:bg-[var(--sh-btn-hover,rgba(148,163,184,0.12))] hover:text-[var(--pm-text-bright,#f5f7fb)]"
    >
      {label}
    </IconButton>
  );
}

/* ---- top toolbar --------------------------------------------------- */

function TopBar() {
  return (
    <Panel className="flex items-center gap-2 px-2.5 py-2">
      <IconButton
        icon={Menu}
        variant="control"
        title="Toggle controls"
        className="h-8 w-8 rounded-[var(--sh-r-sm,9px)] text-[var(--pm-text-dim,#8b93a7)] hover:bg-[var(--sh-btn-hover,rgba(148,163,184,0.12))]"
      >
        menu
      </IconButton>

      {/* brand */}
      <div className="flex items-center gap-2 pr-1 pl-0.5">
        <span
          className="grid h-8 w-8 place-items-center rounded-[10px] text-white shadow-[0_2px_8px_rgba(79,70,229,0.4)]"
          style={{ background: 'var(--sh-accent-grad,linear-gradient(135deg,#7c7cf6,#4f46e5))' }}
        >
          <Atom className="h-[18px] w-[18px]" strokeWidth={2} aria-hidden />
        </span>
        <span className="leading-tight">
          <span className="block text-[14px] font-bold tracking-[-0.01em] text-[var(--pm-text-bright,#f5f7fb)]">
            tenmol
          </span>
          <span className="block text-[10px] text-[var(--pm-text-dim,#8b93a7)]">molecular viewer</span>
        </span>
      </div>

      {/* fetch group */}
      <div className="flex items-center gap-1.5 pl-1">
        <TextInput
          placeholder="PDB ID"
          aria-label="PDB ID"
          className="h-8 w-24 text-[12.5px]"
          defaultValue=""
        />
        <Button variant="bare" tone="accent" icon={Search} className="h-8 px-3.5 text-[12.5px]">
          Fetch
        </Button>
      </div>

      <span className="mx-0.5 h-6 w-px bg-[var(--pm-line,rgba(148,163,184,0.16))]" />

      {/* file + tools */}
      <nav className="flex items-center gap-0.5">
        {(
          [
            { icon: Upload, label: 'Open' },
            { icon: Save, label: 'Save' },
          ] as const
        ).map((b) => (
          <Button
            key={b.label}
            variant="menubar"
            icon={b.icon}
            className="h-8 px-2.5 text-[12.5px] text-[var(--pm-text,#dfe4ee)]"
          >
            {b.label}
          </Button>
        ))}
      </nav>

      <span className="ml-auto" />

      <nav className="flex items-center gap-0.5">
        {(
          [
            { icon: Ruler, label: 'Distance' },
            { icon: Sparkles, label: 'Advanced' },
            { icon: GitCompareArrows, label: 'Align' },
            { icon: Camera, label: 'Render/Export' },
          ] as const
        ).map((b) => (
          <Button
            key={b.label}
            variant="menubar"
            icon={b.icon}
            className="h-8 px-2.5 text-[12.5px] text-[var(--pm-text,#dfe4ee)]"
          >
            {b.label}
          </Button>
        ))}
      </nav>

      <span className="mx-0.5 h-6 w-px bg-[var(--pm-line,rgba(148,163,184,0.16))]" />

      <div className="flex items-center gap-1">
        <RoundIcon icon={Info} label="About" />
        <RoundIcon icon={Contrast} label="Appearance" />
        <RoundIcon icon={Maximize2} label="Full screen" />
      </div>
    </Panel>
  );
}

/* ---- left rail ----------------------------------------------------- */

const REPS: { id: string; label: string; icon: LucideIcon }[] = [
  { id: 'cartoon', label: 'Cartoon', icon: Spline },
  { id: 'stick', label: 'Stick', icon: PenLine },
  { id: 'sphere', label: 'Sphere', icon: Circle },
  { id: 'ballstick', label: 'Ball·Stick', icon: Atom },
  { id: 'line', label: 'Line', icon: Minus },
  { id: 'surface', label: 'Surface', icon: Droplet },
  { id: 'hide', label: 'Hide', icon: EyeOff },
];

const SCHEMES: { id: string; label: string; swatch: string; expandable?: boolean }[] = [
  { id: 'spectrum', label: 'Spectrum', swatch: 'linear-gradient(90deg,#6d5efc,#22d3ee,#34d399,#facc15,#fb7185)' },
  { id: 'chain', label: 'Chain', swatch: 'linear-gradient(90deg,#f97316,#22c55e,#3b82f6)' },
  { id: 'ss', label: 'Secondary structure', swatch: 'linear-gradient(90deg,#f43f5e,#f59e0b,#e5e7eb)' },
  { id: 'element', label: 'Element (CPK)', swatch: 'linear-gradient(90deg,#94a3b8,#ef4444,#3b82f6)' },
  { id: 'bfactor', label: 'B-factor', swatch: 'linear-gradient(90deg,#2563eb,#22d3ee,#fca5a5,#dc2626)' },
  { id: 'hydro', label: 'Hydrophobicity', swatch: 'linear-gradient(90deg,#f2c14e,#e2e8f0,#4f46e5)', expandable: true },
];

function LeftRail() {
  const [rep, setRep] = useState('cartoon');
  const [scheme, setScheme] = useState('spectrum');
  return (
    <Panel className="flex w-[236px] flex-none flex-col gap-4 self-start p-3.5">
      <div className="flex flex-col gap-2.5">
        <SectionLabel>Representation</SectionLabel>
        <div className="grid grid-cols-3 gap-2">
          {REPS.map((r) => {
            const Icon = r.icon;
            const on = rep === r.id;
            return (
              <button
                key={r.id}
                type="button"
                onClick={() => setRep(r.id)}
                aria-pressed={on}
                className={[
                  'flex flex-col items-center justify-center gap-1.5 rounded-[11px] border px-2 py-2.5 transition-[color,background-color,border-color,box-shadow]',
                  on
                    ? 'border-[color-mix(in_srgb,var(--pm-accent,#6366f1)_50%,transparent)] bg-[var(--sh-accent-soft,rgba(99,102,241,0.14))] text-[var(--pm-accent,#6366f1)] shadow-[0_1px_2px_rgba(79,70,229,0.18)]'
                    : 'border-[var(--sh-btn-border,rgba(148,163,184,0.14))] bg-[var(--sh-btn-fill,rgba(148,163,184,0.06))] text-[var(--pm-text,#dfe4ee)] hover:border-[var(--sh-btn-border-strong,rgba(148,163,184,0.24))] hover:bg-[var(--sh-btn-hover,rgba(148,163,184,0.12))]',
                ].join(' ')}
              >
                <Icon className="h-[18px] w-[18px]" strokeWidth={1.75} aria-hidden />
                <span className="text-[11px] font-medium leading-none">{r.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <SectionLabel>Coloring</SectionLabel>
        <div className="flex flex-col gap-0.5">
          {SCHEMES.map((s) => {
            const on = scheme === s.id;
            return (
              <button
                key={s.id}
                type="button"
                onClick={() => setScheme(s.id)}
                aria-pressed={on}
                className={[
                  'flex w-full items-center gap-2.5 rounded-full border px-2 py-1 text-left transition-[color,background-color,border-color,box-shadow]',
                  on
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
                    on
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
          })}
        </div>
      </div>
    </Panel>
  );
}

/* ---- centre canvas ------------------------------------------------- */

function Canvas() {
  return (
    <Panel className="relative flex min-h-[520px] flex-1 items-center justify-center overflow-hidden">
      {/* faint scatter suggesting a structure, kept to the upper third so it
          never crowds the headline below */}
      <div className="pointer-events-none absolute inset-x-0 top-0 h-[42%] opacity-45">
        <svg viewBox="0 0 400 170" className="h-full w-full" preserveAspectRatio="xMidYMid meet" aria-hidden>
          {Array.from({ length: 22 }).map((_, i) => {
            const cx = 200 + 64 * Math.sin(i * 1.7) * Math.cos(i * 0.6);
            const cy = 24 + i * 6;
            const hue = (i * 28) % 360;
            return <circle key={i} cx={cx} cy={cy} r={5} fill={`hsl(${hue} 70% 62% / 0.55)`} />;
          })}
        </svg>
      </div>
      <div className="relative flex flex-col items-center gap-1.5 text-center">
        <span className="text-[20px] font-bold text-[var(--pm-text-bright,#f5f7fb)]">
          A clean canvas awaits
        </span>
        <span className="text-[13px] text-[var(--pm-text-dim,#8b93a7)]">
          Enter a PDB ID, open a file, or drag &amp; drop a structure
        </span>
      </div>
    </Panel>
  );
}

/* ---- right rail ---------------------------------------------------- */

function EmptyState({ icon, children }: { icon: LucideIcon; children: string }) {
  const Icon = icon;
  return (
    <div className="flex flex-col items-center gap-2 py-6 text-center">
      <Icon className="h-6 w-6 text-[var(--pm-text-dim,#8b93a7)] opacity-60" strokeWidth={1.5} aria-hidden />
      <span className="text-[12px] text-[var(--pm-text-dim,#8b93a7)]">{children}</span>
    </div>
  );
}

function RightRail() {
  return (
    <Panel className="flex w-[258px] flex-none flex-col self-start">
      <div className="border-b border-[var(--pm-line,rgba(148,163,184,0.14))] px-3.5 py-3">
        <SectionLabel>Objects &amp; Selections</SectionLabel>
      </div>
      <div className="flex flex-col gap-1 p-3.5">
        <SectionLabel>Objects</SectionLabel>
        <EmptyState icon={Boxes}>No structure loaded</EmptyState>
        <SectionLabel>Quick selections</SectionLabel>
        <EmptyState icon={Layers}>Load a structure</EmptyState>
        <div className="flex items-center justify-between pt-1">
          <SectionLabel>Selections</SectionLabel>
          <span className="flex items-center gap-1">
            <IconButton
              icon={Sparkles}
              variant="control"
              title="Add"
              className="h-6 w-6 rounded-[7px] text-[var(--pm-text-dim,#8b93a7)] hover:bg-[var(--sh-btn-hover,rgba(148,163,184,0.12))]"
            >
              add
            </IconButton>
          </span>
        </div>
        <EmptyState icon={MousePointerClick}>Click residues to start a selection</EmptyState>
      </div>
    </Panel>
  );
}

/* ---- assembly ------------------------------------------------------ */

function ViewerChrome() {
  return (
    <div className="flex min-h-[600px] flex-col gap-3">
      <TopBar />
      <div className="flex flex-1 gap-3">
        <LeftRail />
        <Canvas />
        <RightRail />
      </div>
    </div>
  );
}

const meta = {
  title: 'Bundles/Viewer Chrome',
  parameters: { layout: 'fullscreen' },
} satisfies Meta<typeof ViewerChrome>;

export default meta;
type Story = StoryObj<typeof meta>;

/** The full viewer layout — top bar, left rail, canvas, right rail. */
export const Full: Story = {
  render: () => <ViewerChrome />,
};
