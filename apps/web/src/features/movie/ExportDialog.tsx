/**
 * Movie export: numbered PNGs (`cmd.mpng`) and encoded movies
 * (`cmd.movie.produce`).
 *
 * Form fields follow the Qt dialog (`packages/engine/modules/pmg_qt/file_dialogs.py:691`):
 * width/height seeded from `get_viewport()`, 720p/480p/360p presets clamped to
 * <= 16:9, an encoder combo, a quality spinbox seeded from `movie_quality` and
 * disabled for ''/convert, a `ray` checkbox seeded from `ray_trace_frames`, and
 * format radios enabled per the encoder probe.
 *
 * **The PNG path deliberately uses `modal=0`** — blocker A2. `modal=1` installs
 * `MovieModalDraw` and until the pump has drawn enough times every other API
 * call raises `APIEnterNotModal`; measured here, the very next `count_atoms`
 * after a modal `mpng` raised, and cleared 0.16 s later. `cmd.movie_export_png`
 * on the bridge runs `MoviePNG`'s own synchronous loop inside one pump task
 * instead, so the engine is never observably wedged. See
 * `packages/bridge/tenmol_bridge/panels/movie.py`.
 */

import { useEffect, useRef, useState } from 'react';
import type { MovieEncoders, MovieProducePlan, MovieStatus } from '@tenmol/protocol/topics/movie';
import type { MovieSource } from './movieSource';

interface Props {
  status: MovieStatus;
  source: MovieSource;
  call: <T>(fn: string, args?: readonly unknown[], kwargs?: Record<string, unknown>) => Promise<T>;
  onClose: () => void;
  log: (line: string) => void;
}

const FORMATS = ['png', 'mp4', 'webm', 'mpg', 'mov', 'gif'] as const;
type Format = (typeof FORMATS)[number];

/** `file_dialogs.py` presets: clamp to <= 16:9, keep the aspect. */
export function presetSize(height: number, current: [number, number]): [number, number] {
  const [w, h] = current;
  const aspect = h > 0 ? w / h : 16 / 9;
  const clamped = Math.min(aspect, 16 / 9);
  return [Math.round(height * clamped), height];
}

/**
 * `movie.produce`'s encoder guess (`movie.py:915-933`), plus the availability
 * check it makes right afterwards.
 *
 * `.mpg`/`.mpeg` go to `mpeg_encode` UNCONDITIONALLY — `produce` never falls
 * back to ffmpeg for them, it just fails inside `_encode` with
 * `produce-error: Unable to validate pymol.mpeg_encode` (measured: the frames
 * are still rendered, as `.ppm`, and then thrown away). So a missing
 * `mpeg_encode` has to grey `.mpg` out here rather than silently redirect it.
 *
 * `convert` is only ever reached when ffmpeg is absent, and it is not
 * gif-specific: `_encode`'s convert branch runs for any extension.
 */
export function encoderFor(format: Format, encoders: MovieEncoders | null): string | null {
  if (format === 'png') return null;
  if (format === 'mpg') return encoders?.mpeg_encode ? 'mpeg_encode' : null;
  if (encoders?.ffmpeg) return 'ffmpeg';
  if (encoders?.convert) return 'convert';
  return null;
}

export function ExportDialog({ status, source, call, onClose, log }: Props) {
  const [size, setSize] = useState<[number, number]>([640, 480]);
  const [format, setFormat] = useState<Format>('png');
  const [quality, setQuality] = useState(90);
  const [ray, setRay] = useState(false);
  const [prefix, setPrefix] = useState('/tmp/tenmol-movie/frame');
  const [encoders, setEncoders] = useState<MovieEncoders | null>(null);
  const [plan, setPlan] = useState<MovieProducePlan | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  // Seed ONCE. Re-seeding on every status poll (10 Hz) would overwrite the
  // width the user is halfway through typing, so the effect reads `status`
  // through a ref and depends only on things that never change.
  const seed = useRef({ status, call, source });
  seed.current = { status, call, source };

  useEffect(() => {
    let alive = true;
    void (async () => {
      const { status: current, call: rpc, source: src } = seed.current;
      try {
        const viewport = await rpc<[number, number]>('cmd.get_viewport');
        if (alive && Array.isArray(viewport) && viewport.length === 2) {
          setSize([viewport[0], viewport[1]]);
        }
      } catch {
        /* the seed is cosmetic */
      }
      const found = await src.encoders();
      if (!alive) return;
      setEncoders(found);
      setQuality(Number(current.settings.movie_quality ?? 90));
      setRay(current.settings.ray_trace_frames === true);
    })();
    return () => {
      alive = false;
    };
  }, []);

  const encoder = encoderFor(format, encoders);
  const supported = format === 'png' || encoder !== null;
  const filename = `${prefix}.${format}`;

  // The plan is what `produce` will decide, fetched before the button is
  // pressed so the form can show the resolved (even) size and the exact `-crf`
  // rather than describing an export that has not happened yet.
  useEffect(() => {
    if (format === 'png') {
      setPlan(null);
      return;
    }
    let alive = true;
    void seed.current.source
      .producePlan(filename, { width: size[0], height: size[1], quality })
      .then((value) => {
        if (alive) setPlan(value);
      });
    return () => {
      alive = false;
    };
  }, [filename, format, size, quality]);

  const doExport = async () => {
    setBusy(true);
    setResult(null);
    try {
      if (format === 'png') {
        const out = await source.exportPng(prefix, {
          width: size[0],
          height: size[1],
          mode: ray ? 2 : -1,
          quiet: 0,
        });
        if (out) {
          setResult(`${out.count} PNG${out.count === 1 ? '' : 's'} in ${out.dir}`);
          log(`cmd.mpng("${prefix}", mode=${ray ? 2 : -1})  ->  ${out.count} files`);
        } else {
          setResult('export endpoint unavailable');
        }
      } else {
        const out = await source.produce(filename, {
          mode: ray ? 'ray' : 'draw',
          quality,
          width: size[0],
          height: size[1],
          quiet: 0,
          ...(encoder ? { encoder } : {}),
        });
        setResult(
          out.ok
            ? `wrote ${out.filename} (${out.bytes.toLocaleString()} bytes, ${out.encoder})`
            : `${out.encoder} produced nothing — see the console for its stderr`,
        );
        log(`cmd.movie.produce("${filename}", encoder="${encoder ?? ''}")`);
      }
    } catch (error) {
      setResult(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mvpopup__scrim" onClick={onClose} role="presentation">
      <div className="mvexport" onClick={(event) => event.stopPropagation()} role="dialog">
        <header className="mvexport__head">Export movie</header>

        <div className="mvedit__row">
          <label className="mvedit__label">
            width
            <input
              type="number"
              className="mvedit__num"
              value={size[0]}
              onChange={(event) => setSize([Number(event.target.value), size[1]])}
            />
          </label>
          <label className="mvedit__label">
            height
            <input
              type="number"
              className="mvedit__num"
              value={size[1]}
              onChange={(event) => setSize([size[0], Number(event.target.value)])}
            />
          </label>
          {[720, 480, 360].map((h) => (
            <button key={h} type="button" onClick={() => setSize(presetSize(h, size))}>
              {h}p
            </button>
          ))}
        </div>

        <div className="mvedit__row mvedit__row--wrap">
          {FORMATS.map((value) => {
            const enabled = value === 'png' || encoderFor(value, encoders) !== null;
            return (
              <label key={value} className={`mvedit__label${enabled ? '' : ' is-off'}`}>
                <input
                  type="radio"
                  name="movie-format"
                  checked={format === value}
                  disabled={!enabled}
                  onChange={() => setFormat(value)}
                />
                {value}
              </label>
            );
          })}
        </div>

        <div className="mvedit__row">
          <label className="mvedit__label">
            quality
            <input
              type="number"
              className="mvedit__num"
              value={quality}
              disabled={format === 'png' || encoder === 'convert'}
              onChange={(event) => setQuality(Number(event.target.value))}
            />
          </label>
          <label className="mvedit__label">
            <input type="checkbox" checked={ray} onChange={() => setRay(!ray)} />
            ray
          </label>
          <span className="mvexport__enc">
            encoder: {encoder ?? (format === 'png' ? 'n/a' : 'MISSING')}
          </span>
        </div>

        {plan && (
          <p className="mvedit__note">
            {plan.width || plan.height ? `${plan.width}x${plan.height}` : 'viewport'} ·{' '}
            {plan.frameGlob} · {plan.encoder === 'mpeg_encode' ? `q${plan.mpegQuality}` : `crf ${plan.crf}`}
            {plan.twoPassPalette ? ' · two-pass palette' : ''}
            {plan.fpsAdjusted ? ` · fps snapped ${plan.fps} -> ${plan.fpsLegal}` : ` · ${plan.fps} fps`}
          </p>
        )}

        <div className="mvedit__row">
          <input
            className="mvedit__input"
            value={prefix}
            spellCheck={false}
            onChange={(event) => setPrefix(event.target.value)}
            aria-label="output prefix"
          />
        </div>

        {!supported && (
          <p className="mvedit__error">
            no encoder for .{format} on this machine (pymol.movie.find_exe found none)
          </p>
        )}
        {result && <p className="mvexport__result">{result}</p>}

        <div className="mvedit__row">
          <button type="button" disabled={busy || !supported} onClick={() => void doExport()}>
            {busy ? 'exporting…' : 'export'}
          </button>
          <button type="button" onClick={onClose}>
            close
          </button>
        </div>
      </div>
    </div>
  );
}
