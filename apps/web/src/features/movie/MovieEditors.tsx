/**
 * The three editors under the timeline: `mset`, per-frame `mdo`, and `mview`.
 *
 * `mset` gets a LIVE PREVIEW of the frame->state table (`msetParser.ts`, a port
 * of `moving.py:731-763`) but always sends the raw string — the preview exists
 * so a user can see that `1 x30 1 -15 15 x30 15 -1` is 91 frames before
 * committing, not so the client can compute the movie.
 *
 * `mdo`/`mappend` take a **0-based** frame on the wire (`moving.py:274,323`);
 * the conversion lives in `movieSource.program`, and the UI is 1-based
 * throughout because everything the user sees in PyMOL is.
 */

import { useEffect, useState } from 'react';
import type { MoviePanel } from '@tenmol/protocol/topics/movie';
import { previewMset } from './msetParser';
import { MVIEW_ACTIONS, mview, program, range, type MovieAction } from './movieSource';

interface Props {
  panel: MoviePanel | null;
  frame: number;
  state: number;
  objects: readonly string[];
  run: (action: MovieAction) => Promise<void>;
}

/** The three timeline editors — `mset`, per-frame `mdo`, and `mview` — under the movie panel. */
export function MovieEditors({ panel, frame, state, objects, run }: Props) {
  const [spec, setSpec] = useState('1 x30');
  const [command, setCommand] = useState('');
  const [target, setTarget] = useState(1);
  const [count, setCount] = useState(1);
  const [object, setObject] = useState('');

  const cell = panel?.cells.find((c) => c.frame === frame) ?? null;
  useEffect(() => {
    setCommand(cell?.command ?? '');
  }, [cell?.command, frame]);

  const preview = previewMset(spec, state);
  const kwargs = object ? { object } : {};

  return (
    <div className="mvedit">
      <section className="mvedit__block">
        <header className="mvedit__head">movie program — mset / madd</header>
        <div className="mvedit__row">
          <input
            className="mvedit__input"
            value={spec}
            spellCheck={false}
            onChange={(event) => setSpec(event.target.value)}
            aria-label="mset specification"
          />
          <button type="button" onClick={() => void run(program.mset(spec))}>
            mset
          </button>
          <button type="button" onClick={() => void run(program.madd(spec))}>
            madd
          </button>
          <button type="button" onClick={() => void run(program.purge())} title="cmd.mset()">
            purge
          </button>
        </div>
        <div className="mvedit__preview">
          {preview.error ? (
            <span className="mvedit__error">{preview.error}</span>
          ) : (
            <>
              <span>
                {preview.states.length} frame{preview.states.length === 1 ? '' : 's'} →
              </span>
              <code>
                {preview.states.slice(0, 40).join(' ')}
                {preview.states.length > 40 ? ' …' : ''}
              </code>
            </>
          )}
        </div>
      </section>

      <section className="mvedit__block">
        <header className="mvedit__head">frame {frame} command — mdo / mappend</header>
        <div className="mvedit__row">
          <input
            className="mvedit__input"
            value={command}
            spellCheck={false}
            placeholder="turn x, 5"
            onChange={(event) => setCommand(event.target.value)}
            aria-label="frame command"
          />
          <button type="button" onClick={() => void run(program.mdo(frame, command))}>
            mdo
          </button>
          <button type="button" onClick={() => void run(program.mappend(frame, command))}>
            mappend
          </button>
          <button type="button" onClick={() => void run(program.mdump())} title="prints to console">
            mdump
          </button>
          <button type="button" onClick={() => void run(program.mclear())}>
            mclear
          </button>
        </div>
      </section>

      <section className="mvedit__block">
        <header className="mvedit__head">key frames — mview</header>
        <div className="mvedit__row">
          <label className="mvedit__label">
            object
            <select value={object} onChange={(event) => setObject(event.target.value)}>
              <option value="">(camera)</option>
              {objects.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="mvedit__row mvedit__row--wrap">
          {MVIEW_ACTIONS.map((action) => (
            <button
              key={action}
              type="button"
              title={`cmd.mview('${action}', first=${frame}${object ? `, object='${object}'` : ''})`}
              onClick={() =>
                void run(
                  mview(action, {
                    ...(action === 'store' || action === 'clear' || action === 'toggle'
                      ? { first: frame }
                      : {}),
                    ...kwargs,
                  }),
                )
              }
            >
              {action}
            </button>
          ))}
        </div>
      </section>

      <section className="mvedit__block">
        <header className="mvedit__head">key-frame range — mmove / mcopy / minsert / mdelete</header>
        <div className="mvedit__row">
          <label className="mvedit__label">
            target
            <input
              type="number"
              className="mvedit__num"
              value={target}
              onChange={(event) => setTarget(Number(event.target.value))}
            />
          </label>
          <label className="mvedit__label">
            count
            <input
              type="number"
              className="mvedit__num"
              value={count}
              onChange={(event) => setCount(Number(event.target.value))}
            />
          </label>
          <button type="button" onClick={() => void run(range.mmove(target, frame, count, object))}>
            mmove
          </button>
          <button type="button" onClick={() => void run(range.mcopy(target, frame, count, object))}>
            mcopy
          </button>
          <button type="button" onClick={() => void run(range.minsert(count, frame, object))}>
            minsert
          </button>
          <button type="button" onClick={() => void run(range.mdelete(count, frame, object))}>
            mdelete
          </button>
        </div>
        <p className="mvedit__note">
          0 means &ldquo;current frame&rdquo; and a negative counts back from the end
          (moving.py:493) — the numbers go over the wire untouched.
        </p>
      </section>
    </div>
  );
}
