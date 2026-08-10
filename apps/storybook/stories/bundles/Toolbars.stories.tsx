/**
 * Bundles / Toolbars — the app's toolbar rows, composed from the Button family.
 *
 * Each row is a `<Toolbar role="toolbar">` band packed with one Button variant:
 * `quick` for the quick-action strip, `control` (as `IconButton`) for the movie
 * transport, and `extgui` for the external-GUI launchers. Stacking them lets you
 * compare density and styling across themes — flip the toolbar Theme to compare
 * classic vs. modern, and Appearance for dark/light in the modern theme.
 */

import type { ReactNode } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import {
  ChevronLeft,
  ChevronRight,
  Play,
  SkipBack,
  SkipForward,
  Square,
} from 'lucide-react';

import { Button, IconButton, Toolbar } from '@web/ui';

const meta = {
  title: 'Bundles/Toolbars',
  parameters: { layout: 'padded' },
} satisfies Meta<typeof Toolbar>;

export default meta;
type Story = StoryObj<typeof meta>;

/** A quick-action strip: `quick`-variant buttons for the common viewport verbs. */
function QuickRow() {
  return (
    <Toolbar style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
      <Button variant="quick">Reset</Button>
      <Button variant="quick">Zoom</Button>
      <Button variant="quick">Rock</Button>
      <Button variant="quick">Draw</Button>
      <Button variant="quick">Ray</Button>
    </Toolbar>
  );
}

/** The movie transport: `control`-variant `IconButton`s with skip/play/stop icons. */
function TransportRow() {
  return (
    <Toolbar style={{ display: 'flex', flexWrap: 'wrap', gap: 4, alignItems: 'center' }}>
      <IconButton variant="control" icon={SkipBack} title="|<">
        first
      </IconButton>
      <IconButton variant="control" icon={ChevronLeft} title="<">
        previous
      </IconButton>
      <IconButton variant="control" icon={Square} title="Stop">
        stop
      </IconButton>
      <IconButton variant="control" icon={Play} title="Play">
        play
      </IconButton>
      <IconButton variant="control" icon={ChevronRight} title=">">
        next
      </IconButton>
      <IconButton variant="control" icon={SkipForward} title=">|">
        last
      </IconButton>
    </Toolbar>
  );
}

/** The external-GUI launcher strip: `extgui`-variant buttons. */
function ExtguiRow() {
  return (
    <Toolbar style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
      <Button variant="extgui">Builder</Button>
      <Button variant="extgui">Properties</Button>
      <Button variant="extgui">Volume</Button>
      <Button variant="extgui">Render</Button>
    </Toolbar>
  );
}

/** A small labelled wrapper so each row reads clearly in the gallery. */
function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div style={{ display: 'grid', gap: 6 }}>
      <span style={{ opacity: 0.6, fontSize: 12 }}>{label}</span>
      {children}
    </div>
  );
}

/** All three toolbar rows stacked, showing the quick/control/extgui variants together. */
export const Rows: Story = {
  render: () => (
    <div style={{ display: 'grid', gap: 20 }}>
      <Row label="Quick">
        <QuickRow />
      </Row>
      <Row label="Transport">
        <TransportRow />
      </Row>
      <Row label="Extgui">
        <ExtguiRow />
      </Row>
    </div>
  ),
};
