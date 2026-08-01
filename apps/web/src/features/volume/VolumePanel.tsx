/**
 * `<name> - Volume Color Map Editor` — the container of `_VolumePanel`
 * (`modules/pmg_qt/volume.py:811-877`).
 *
 * Layout, top to bottom: the object/preset header (the web equivalent of
 * reaching the panel through `A > volume`), the ramp canvas, and the button row
 * upstream builds at `:838-854` — `Get colors as script`, `Reset Data Range`,
 * `Help`, a stretch, and a checked-by-default `Update volume colors in
 * real-time`.
 *
 * State ownership: this component holds the ramp points, the view window
 * (vmin/vmax/amax) and the histogram; `<VolumeCanvas>` holds only what changes
 * per pointer event. The split matters because `Reset Data Range` and the
 * script dialog need the same numbers the canvas is drawing.
 *
 * PUSH DISCIPLINE (`volume.py:423-424`, `:856-862`). The real-time checkbox
 * gates DRAGS and colour-dialog previews and nothing else. Add, remove, wheel
 * and the end of every release push unconditionally. That asymmetry is
 * deliberate upstream and is reproduced here call for call.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  BUILTIN_VOLUME_RAMPS,
  type FlatVolumeRamp,
  type VolumeRampPoint,
} from '@tenmol/protocol/topics/dialogs';
import { useSession } from '../../app';
import { DialogWindow } from '../dialogs/DialogWindow';
import { NumberPrompt, TextDialog, type NumberPromptSpec } from '../dialogs/modals';
import type { DialogWindowSpec } from '../dialogs/store';
import { useHostedWindows } from '../dialogs/useDialogs';
import { VolumeCanvas, type ColorPickRequest, type PointPromptRequest } from './VolumeCanvas';
import { type ValueBoxKey } from './paint';
import {
  VOLUME_HELP,
  changePointColor,
  colorsAsScript,
  flatToPoints,
  fromHexColor,
  normalizeHistogram,
  pointPrompt,
  pointsToFlat,
  randomRampName,
  toHexColor,
  valueBoxPrompt,
  type RampView,
} from './ramp';
import { applyPreset, fetchHistogram, getRamp, setRamp } from './service';
import './volume.css';

type Modal =
  | { kind: 'none' }
  | { kind: 'text'; title: string; text: string }
  | { kind: 'number'; spec: NumberPromptSpec; apply: (value: number) => void };

export function VolumePanel({ spec }: { spec: DialogWindowSpec }) {
  const session = useSession();
  const name = spec.arg;

  const [points, setPoints] = useState<VolumeRampPoint[]>([]);
  const [view, setView] = useState<RampView>({
    width: 600,
    height: 200,
    vmin: 0,
    vmax: 1,
    amax: 1,
  });
  const [original, setOriginal] = useState({ vmin: 0, vmax: 1 });
  const [path, setPath] = useState<readonly (readonly [number, number])[]>([]);
  const [realTime, setRealTime] = useState(true);
  const [colorIndex, setColorIndex] = useState(0);
  const [modal, setModal] = useState<Modal>({ kind: 'none' });
  const [picker, setPicker] = useState<{
    request: ColorPickRequest;
    original: VolumeRampPoint;
  } | null>(null);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');

  /** The newest points/view, readable from a callback that closed over an old render. */
  const pointsRef = useRef(points);
  pointsRef.current = points;
  const viewRef = useRef(view);
  viewRef.current = view;

  const push = useCallback(
    (next: readonly VolumeRampPoint[]) => {
      void setRamp(session, name, pointsToFlat(next)).catch((e: unknown) =>
        setError(e instanceof Error ? e.message : String(e)),
      );
    },
    [session, name],
  );

  /**
   * Set the points AND the ref, in that order, before anything else runs.
   *
   * THIS ORDER IS THE WHOLE BUG FIX. `mouseReleaseEvent` ends with an
   * unconditional `updateVolumeColors()` (`volume.py:365`) *after* the branch
   * that removed a point has already pushed. In Qt that is harmless because
   * `self.points` was mutated in place, so the second push sends the same new
   * list. In React `setPoints` is asynchronous: the release push would read the
   * ref one render behind and RE-SEND THE POINT IT HAD JUST DELETED. Measured
   * against the running engine — the panel showed 5 stops while
   * `cmd.volume_color` still answered 6. Writing the ref synchronously restores
   * Qt's semantics exactly.
   */
  const commit = useCallback(
    (next: VolumeRampPoint[], shouldPush: boolean) => {
      pointsRef.current = next;
      setPoints(next);
      if (shouldPush) push(next);
    },
    [push],
  );

  /* --------------------------------------------------------------- load */

  const reload = useCallback(async () => {
    setError('');
    try {
      const flat: FlatVolumeRamp = await getRamp(session, name);
      const parsed = flatToPoints(flat);
      if (parsed) {
        pointsRef.current = parsed;
        setPoints(parsed);
      }

      const fetched = await fetchHistogram(session, name, flat);
      // `setHistogram` reverts to the CURRENT range when it sees a NaN, so the
      // normalisation is given the range that is on screen right now.
      const normalized = normalizeHistogram(fetched.histogram, viewRef.current);
      setView((v) => ({ ...v, vmin: normalized.vmin, vmax: normalized.vmax }));
      setPath(normalized.path);
      setOriginal({ vmin: normalized.vmin, vmax: normalized.vmax });
      setStatus(
        `histogram via ${fetched.source}` +
          (fetched.note ? ` — ${fetched.note}` : '') +
          (normalized.warning ? ` — ${normalized.warning}` : ''),
      );
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [session, name]);

  useEffect(() => {
    void reload();
  }, [reload]);

  /* -------------------------------------------------------------- prompts */

  const onValueBoxPrompt = useCallback(
    (key: ValueBoxKey) => {
      const promptSpec = valueBoxPrompt(view, key);
      setModal({
        kind: 'number',
        spec: promptSpec,
        // Value boxes are view-only: they never push (volume.py:292-309).
        apply: (value) => setView((v) => ({ ...v, [key]: value })),
      });
    },
    [view],
  );

  const onPrompt = useCallback(
    (request: PointPromptRequest) => {
      const current = pointsRef.current;
      if (request.point < 0 || request.point >= current.length) return;
      const promptSpec = pointPrompt(view, current, request.point, request.which);
      setModal({
        kind: 'number',
        spec: promptSpec,
        apply: (value) => {
          const next = [...pointsRef.current];
          const p = next[request.point];
          if (!p) return;
          next[request.point] =
            request.which === 'value' ? { ...p, value } : { ...p, alpha: value };
          commit(next, realTime);
        },
      });
    },
    [view, realTime, commit],
  );

  const onColorPick = useCallback((request: ColorPickRequest) => {
    const current = pointsRef.current[request.point];
    if (!current) return;
    setPicker({ request, original: current });
  }, []);

  const onSize = useCallback(
    (width: number, height: number) => setView((v) => ({ ...v, width, height })),
    [],
  );
  const onViewPatch = useCallback(
    (patch: Partial<RampView>) => setView((v) => ({ ...v, ...patch })),
    [],
  );
  const onRelease = useCallback(() => push(pointsRef.current), [push]);

  /* --------------------------------------------------------------- render */

  const footer = (
    <div className="volpanel__buttons">
      <button
        type="button"
        data-volume-script=""
        onClick={() =>
          setModal({
            kind: 'text',
            title: 'Volume color ramp',
            text: colorsAsScript(points, randomRampName()),
          })
        }
      >
        Get colors as script
      </button>
      <button
        type="button"
        data-volume-reset=""
        onClick={() => {
          // `reset()` (volume.py:739-746) restores the range AND re-pushes.
          setView((v) => ({ ...v, vmin: original.vmin, vmax: original.vmax }));
          push(points);
        }}
      >
        Reset Data Range
      </button>
      <button
        type="button"
        data-volume-help=""
        onClick={() => setModal({ kind: 'text', title: 'Volume panel help', text: VOLUME_HELP })}
      >
        Help
      </button>
      <span className="volpanel__spacer" />
      <label className="volpanel__check">
        <input
          type="checkbox"
          data-volume-realtime=""
          checked={realTime}
          onChange={(e) => setRealTime(e.target.checked)}
        />
        Update volume colors in real-time
      </label>
    </div>
  );

  return (
    <DialogWindow spec={spec} footer={footer}>
      <div className="volpanel">
        <div className="volpanel__head">
          <label className="volpanel__preset">
            preset
            <select
              data-volume-preset=""
              defaultValue=""
              onChange={(e) => {
                const preset = e.target.value;
                if (!preset) return;
                void applyPreset(session, name, preset)
                  .then(() => reload())
                  .catch((err: unknown) =>
                    setError(err instanceof Error ? err.message : String(err)),
                  );
                e.target.value = '';
              }}
            >
              <option value="">named ramp…</option>
              {BUILTIN_VOLUME_RAMPS.map((ramp) => (
                <option key={ramp} value={ramp}>
                  {ramp}
                </option>
              ))}
            </select>
          </label>
          <button type="button" data-volume-reload="" onClick={() => void reload()}>
            Reload
          </button>
          <span className="volpanel__spacer" />
          <span className="volpanel__count" data-volume-count={points.length}>
            {points.length} stops
          </span>
        </div>

        {error && <div className="volpanel__error">{error}</div>}
        {!error && status && <div className="volpanel__status">{status}</div>}

        <VolumeCanvas
          view={view}
          points={points}
          path={path}
          originalVmin={original.vmin}
          originalVmax={original.vmax}
          realTime={realTime}
          colorIndex={colorIndex}
          onSize={onSize}
          onPoints={commit}
          onView={onViewPatch}
          onColorIndex={setColorIndex}
          onRelease={onRelease}
          onPrompt={onPrompt}
          onValueBoxPrompt={onValueBoxPrompt}
          onColorPick={onColorPick}
        />

        {picker && (
          <div className="volpanel__picker">
            <span>
              point {picker.request.point}
              {picker.request.triple ? ' (+neighbours)' : ''}
            </span>
            <input
              type="color"
              data-volume-color=""
              autoFocus
              defaultValue={toHexColor(picker.original.r, picker.original.g, picker.original.b)}
              onChange={(e) => {
                // `currentColorChanged` -> live preview, pushed only when
                // real-time is on (volume.py:384-390).
                commit(
                  changePointColor(
                    pointsRef.current,
                    picker.request.point,
                    fromHexColor(e.target.value),
                    picker.request.triple,
                  ),
                  realTime,
                );
              }}
            />
            <button
              type="button"
              data-volume-color-ok=""
              onClick={() => {
                push(pointsRef.current);
                setPicker(null);
              }}
            >
              OK
            </button>
            <button
              type="button"
              data-volume-color-cancel=""
              onClick={() => {
                // Rejecting restores the original colour and re-pushes
                // (`colorDialogClosed`, volume.py:392-402).
                commit(
                  changePointColor(
                    pointsRef.current,
                    picker.request.point,
                    [picker.original.r, picker.original.g, picker.original.b],
                    picker.request.triple,
                  ),
                  true,
                );
                setPicker(null);
              }}
            >
              Cancel
            </button>
          </div>
        )}

        {modal.kind === 'text' && (
          <TextDialog
            title={modal.title}
            text={modal.text}
            onClose={() => setModal({ kind: 'none' })}
          />
        )}
        {modal.kind === 'number' && (
          <NumberPrompt
            spec={modal.spec}
            onDone={(value) => {
              if (value !== null) modal.apply(value);
              setModal({ kind: 'none' });
            }}
          />
        )}
      </div>
    </DialogWindow>
  );
}

/** The kinds this slot hosts when the `dialogs` slot is not mounted. */
const HOSTS = ['volume'] as const;

/** Slot panel: every open volume window. Nothing renders when none is open. */
export function VolumeSlot() {
  const windows = useHostedWindows(HOSTS);
  return (
    <>
      {windows.map((w) => (
        <VolumePanel key={w.key} spec={w} />
      ))}
    </>
  );
}
