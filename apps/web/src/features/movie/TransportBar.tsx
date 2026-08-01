/**
 * The internal-GUI control bar — nine equal-width buttons.
 *
 * `CControl::draw` lays out nine buttons hit-tested as `(9*x)/width`
 * (`layer1/Control.cpp:224`), and `CControl::release` (`:288-380`) defines what
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

import type { MovieStatus } from '@tenmol/protocol/topics/movie';
import { transport, type MovieAction } from './movieSource';

interface Props {
  status: MovieStatus;
  run: (action: MovieAction) => Promise<void>;
}

export function TransportBar({ status, run }: Props) {
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

  return (
    <div className="mvctl" role="toolbar" aria-label="movie transport">
      <button
        type="button"
        className="mvctl__btn"
        title="rewind — cmd.rewind()"
        data-testid="mv-rewind"
        onClick={() => void run(transport.rewind())}
      >
        |&lt;
      </button>
      <button
        type="button"
        className="mvctl__btn"
        title="back one frame — cmd.backward()"
        data-testid="mv-back"
        onClick={() => void run(transport.backward())}
      >
        &lt;
      </button>
      <button
        type="button"
        className="mvctl__btn"
        title="stop — also clears sculpting and rock"
        data-testid="mv-stop"
        onClick={() => void onStop()}
      >
        []
      </button>
      <button
        type="button"
        className={`mvctl__btn${playing ? ' is-on' : ''}`}
        title={playing ? 'stop — cmd.mstop()' : 'play — cmd.mplay() (Ctrl rewinds first)'}
        data-testid="mv-play"
        onClick={(event) => void onPlay(event)}
      >
        {playing ? '||' : '>'}
      </button>
      <button
        type="button"
        className="mvctl__btn"
        title="forward one frame — cmd.forward()"
        data-testid="mv-forward"
        onClick={() => void run(transport.forward())}
      >
        &gt;
      </button>
      <button
        type="button"
        className="mvctl__btn"
        title="ending — cmd.ending() (Ctrl = middle)"
        data-testid="mv-ending"
        onClick={(event) => void onEnding(event)}
      >
        &gt;|
      </button>
      <button
        type="button"
        className={`mvctl__btn${seqView ? ' is-on' : ''}`}
        title="sequence viewer — cmd.set('seq_view', ...)"
        data-testid="mv-seq"
        onClick={() => void run(transport.seqView(!seqView))}
      >
        seq
      </button>
      <button
        type="button"
        className={`mvctl__btn${rocking ? ' is-on' : ''}`}
        title="rock — cmd.rock(1) restarts the sweep timer"
        data-testid="mv-rock"
        onClick={() => void run(transport.rock(rocking ? 0 : 1))}
      >
        rock
      </button>
      <button
        type="button"
        className="mvctl__btn"
        title="full screen — cmd.full_screen()"
        data-testid="mv-full"
        onClick={() => void run(transport.fullScreen())}
      >
        full
      </button>
    </div>
  );
}
