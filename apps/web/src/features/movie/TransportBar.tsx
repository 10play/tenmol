/**
 * The internal-GUI control bar — nine equal-width buttons.
 *
 * `CControl::draw` lays out nine buttons hit-tested as `(9*x)/width`
 * (`packages/engine/layer1/Control.cpp:224`), and `CControl::release` (`:288-380`) defines what
 * each one does. Reproduced here as real DOM, with the modifier variants:
 *
 *   0 |<     rewind        `SceneSetFrame(G,4,0)`
 *   1 <      back          `SceneSetFrame(G,5,-1)`
 *   2 []     stop          MovieStop **and** clear `sculpting` and `rock`
 *   3 >/||   play/pause    Ctrl rewinds first; pressing while playing stops
 *   4 >      forward       `SceneSetFrame(G,5,1)`
 *   5 >|     ending        Ctrl = middle (`SceneSetFrame(G,3,0)`)
 *   6 seq    `seq_view` toggle
 *   7 rock   `rock` toggle; turning it on restarts the sweep timer
 *   8 full   `full_screen`
 *
 * Button 2 is the one that is easy to get wrong: it is NOT `cmd.mstop`. The C
 * writes `sculpting = 0` and `rock = false` before logging `cmd.mstop()`, so
 * clicking Stop while rocking must stop the rock too.
 */

import {
  ChevronLeft,
  ChevronRight,
  Pause,
  Play,
  SkipBack,
  SkipForward,
  Square,
} from 'lucide-react';

import type { MovieStatus } from '@tenmol/protocol/topics/movie';
import { Button } from '../../ui';
import { transport, type MovieAction } from './movieSource';

interface Props {
  status: MovieStatus;
  run: (action: MovieAction) => Promise<void>;
  /** Where the equivalent command line goes for a button the engine cannot run. */
  onLog?: (line: string) => void;
}

export function TransportBar({ status, run, onLog }: Props) {
  const playing = status.playing;
  const rocking = status.rocking || status.settings.rock === true;
  const seqView = status.settings.seq_view === true;

  const onStop = async () => {
    // CControl::release case 2, in the same order.
    await run(transport.stop());
    if (status.settings.rock) await run(transport.rock(0));
    await run(transport.sculptingOff());
  };

  const onPlay = async (event: React.MouseEvent) => {
    if (!playing && (event.ctrlKey || event.metaKey)) {
      await run(transport.rewind());
      await run(transport.play());
      return;
    }
    await run(playing ? transport.stop() : transport.play());
  };

  const onEnding = async (event: React.MouseEvent) => {
    await run(event.ctrlKey || event.metaKey ? transport.middle() : transport.ending());
  };

  /**
   * Button 8 — the one button whose backend contract cannot be honoured.
   *
   * `CControl::release` case 8 (`Control.cpp:369-376`) logs `cmd.full_screen()`
   * and `PParse`s `full_screen`. MEASURED over this bridge, all three forms —
   * `cmd.full_screen()`, `(0)` and `(1)` — raise ` Error: ` from
   * `_cmd.full_screen` (`viewing.py:1356`): `ExecutiveFullScreen` needs a real
   * window and there is none. Dispatching it therefore does exactly one thing,
   * which is to put a red error line in the user's console.
   *
   * The browser IS the window here, so the gesture is the Fullscreen API and
   * only the command LINE is echoed, dimmed, the way every other panel action
   * echoes. `requestFullscreen` rejects when it is not inside a user gesture
   * (and is simply absent in jsdom) — both are swallowed, because there is
   * nothing to repair and nothing worth telling the user.
   */
  const onFullScreen = async () => {
    onLog?.('cmd.full_screen()');
    try {
      if (document.fullscreenElement) await document.exitFullscreen?.();
      else await document.documentElement.requestFullscreen?.();
    } catch {
      /* refused: not a user gesture, or the API is not available */
    }
  };

  return (
    <div className="mvctl" role="toolbar" aria-label="movie transport">
      <Button
        variant="bare"
        type="button"
        icon={SkipBack}
        iconOnly
        className="mvctl__btn"
        title="rewind — cmd.rewind()"
        data-testid="mv-rewind"
        onClick={() => void run(transport.rewind())}
      >
        |&lt;
      </Button>
      <Button
        variant="bare"
        type="button"
        icon={ChevronLeft}
        iconOnly
        className="mvctl__btn"
        title="back one frame — cmd.backward()"
        data-testid="mv-back"
        onClick={() => void run(transport.backward())}
      >
        &lt;
      </Button>
      <Button
        variant="bare"
        type="button"
        icon={Square}
        iconOnly
        className="mvctl__btn"
        title="stop — also clears sculpting and rock"
        data-testid="mv-stop"
        onClick={() => void onStop()}
      >
        []
      </Button>
      <Button
        variant="bare"
        type="button"
        icon={playing ? Pause : Play}
        iconOnly
        className={`mvctl__btn${playing ? ' is-on' : ''}`}
        title={playing ? 'stop — cmd.mstop()' : 'play — cmd.mplay() (Ctrl rewinds first)'}
        data-testid="mv-play"
        onClick={(event) => void onPlay(event)}
      >
        {playing ? '||' : '>'}
      </Button>
      <Button
        variant="bare"
        type="button"
        icon={ChevronRight}
        iconOnly
        className="mvctl__btn"
        title="forward one frame — cmd.forward()"
        data-testid="mv-forward"
        onClick={() => void run(transport.forward())}
      >
        &gt;
      </Button>
      <Button
        variant="bare"
        type="button"
        icon={SkipForward}
        iconOnly
        className="mvctl__btn"
        title="ending — cmd.ending() (Ctrl = middle)"
        data-testid="mv-ending"
        onClick={(event) => void onEnding(event)}
      >
        &gt;|
      </Button>
      <Button
        variant="bare"
        type="button"
        className={`mvctl__btn${seqView ? ' is-on' : ''}`}
        title="sequence viewer — cmd.set('seq_view', ...)"
        data-testid="mv-seq"
        onClick={() => void run(transport.seqView(!seqView))}
      >
        seq
      </Button>
      <Button
        variant="bare"
        type="button"
        className={`mvctl__btn${rocking ? ' is-on' : ''}`}
        title="rock — cmd.rock(1) restarts the sweep timer"
        data-testid="mv-rock"
        onClick={() => void run(transport.rock(rocking ? 0 : 1))}
      >
        rock
      </Button>
      <Button
        variant="bare"
        type="button"
        className="mvctl__btn"
        title="full screen — the browser Fullscreen API (cmd.full_screen needs a window)"
        data-testid="mv-full"
        onClick={() => void onFullScreen()}
      >
        full
      </Button>
    </div>
  );
}
