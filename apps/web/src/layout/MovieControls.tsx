import type { FrameState } from './placeholderData';
import { useBridge } from '../bridge/BridgeContext';

/**
 * Movie / frame control bar -- the Control block, packages/engine/layer1/Control.cpp.
 *
 * `NButton = 9` (packages/engine/layer1/Control.cpp:62), evenly spaced, box size
 * `cControlBoxSize = DIP2PIXEL(17)`. Order and actions are exactly
 * packages/engine/layer1/Control.cpp:298-376 (see docs/internal-gui.md §4):
 *
 *   0 |<   rewind        1 <    back        2 [] mstop
 *   3 >    mplay/mstop   4 >    forward     5 >| ending (Ctrl -> middle)
 *   6 S    seq_view      7 v    rock        8 F  full_screen
 *
 * "Lit" states (ActiveColor {0.65,0.65,0.65}, packages/engine/layer1/Control.cpp:645-649):
 * 6 when seq_view, 3 when MoviePlaying, 7 when rock.
 *
 * Not implemented here: the left-gutter "nub" that live-resizes `internal_gui_width`
 * and collapses the panel on double click (packages/engine/layer1/Control.cpp:448-469) -- the shell's
 * column splitter covers the resize, and the collapse gesture belongs with it.
 */

interface Btn {
  key: string;
  glyph: string;
  title: string;
  cmd: string;
  lit?: (f: FrameState) => boolean;
}

const BUTTONS: Btn[] = [
  { key: 'rewind', glyph: '⏮', title: 'rewind to frame 1 (cmd.rewind)', cmd: 'rewind' },
  { key: 'back', glyph: '◀', title: 'step back (cmd.back)', cmd: 'back' },
  { key: 'stop', glyph: '■', title: 'stop (cmd.mstop)', cmd: 'mstop' },
  {
    key: 'play',
    glyph: '▶',
    title: 'play / stop (cmd.mplay)',
    cmd: 'mplay',
    lit: (f) => f.playing,
  },
  { key: 'forward', glyph: '▶', title: 'step forward (cmd.forward)', cmd: 'forward' },
  { key: 'end', glyph: '⏭', title: 'go to end (cmd.ending)', cmd: 'ending' },
  {
    key: 'seq',
    glyph: 'S',
    title: 'toggle sequence viewer (seq_view)',
    cmd: 'set seq_view, 1',
    lit: (f) => f.seqView,
  },
  {
    key: 'rock',
    glyph: '▼',
    title: 'toggle rocking (cmd.rock)',
    cmd: 'rock',
    lit: (f) => f.rocking,
  },
  { key: 'full', glyph: 'F', title: 'full screen (cmd.full_screen)', cmd: 'full_screen' },
];

export function MovieControls({ frame }: { frame: FrameState }) {
  const bridge = useBridge();
  return (
    <div className="control">
      <div className="control__nub" title="drag to resize the panel (internal_gui_width)" />
      <div className="control__buttons">
        {BUTTONS.map((b) => (
          <button
            type="button"
            key={b.key}
            className={'control__btn' + (b.lit?.(frame) ? ' is-lit' : '')}
            title={b.title}
            onClick={() => {
              void bridge.do(b.cmd).catch(() => undefined);
            }}
          >
            {b.glyph}
          </button>
        ))}
      </div>
    </div>
  );
}
