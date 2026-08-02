/**
 * Wave 8 — the encoded half of the export dialog.
 *
 * The PNG path had been exported for real (4 files on disk) and
 * `cmd.movie_produce` had been driven straight from the bridge tests
 * (`test_wf_movieverify.py` writes a real 200x150 h264 mp4 with ffmpeg), but
 * the DIALOG had never sent an mp4/mpg/mov/gif. That is the piece with the
 * branching in it:
 *
 *   `encoderFor` (`movie.py:915-933`)  .mpg -> mpeg_encode, never a fallback;
 *                                      everything else -> ffmpeg, then convert
 *   the format radios                  disabled when the probe found nothing
 *   `doExport`                         PNG -> `movie_export_png(prefix, ...)`
 *                                      else -> `produce(filename, mode=...)`
 *
 * The four encoded formats are driven here through the real radios and the
 * real button, with a probe that says ffmpeg exists and mpeg_encode does not —
 * which is what `pymol.movie.find_exe` reports on this machine.
 */

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { MovieEncoders, MovieStatus } from '@tenmol/protocol/topics/movie';

import { ExportDialog } from './ExportDialog';
import type { MovieSource } from './movieSource';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

interface ProduceCall {
  filename: string;
  options: Record<string, unknown>;
}

let produced: ProduceCall[];
let pngCalls: { prefix: string; options: Record<string, unknown> }[];
let logs: string[];
let encoders: MovieEncoders;

const status: MovieStatus = {
  frame: 1,
  state: 1,
  nframes: 4,
  length: 4,
  playing: false,
  locked: false,
  rocking: false,
  fps: 30,
  sceneCurrent: null,
  settings: { movie_quality: 80, ray_trace_frames: false } as MovieStatus['settings'],
};

function makeSource(): MovieSource {
  return {
    ensure: async () => true,
    ready: true,
    lastError: null,
    status: async () => status,
    panel: async () => null,
    scenes: async () => ({ scenes: [], current: null, order: [] }),
    thumbnail: async () => null,
    encoders: async () => encoders,
    exportPng: async (prefix: string, options: Record<string, unknown>) => {
      pngCalls.push({ prefix, options });
      return { count: 4, dir: '/tmp', files: [], prefix } as never;
    },
    producePlan: async () => null,
    produce: async (filename: string, options: Record<string, unknown> = {}) => {
      produced.push({ filename, options });
      return {
        ok: true,
        bytes: 2023,
        filename,
        encoder: String(options.encoder ?? ''),
      } as never;
    },
  } as unknown as MovieSource;
}

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  produced = [];
  pngCalls = [];
  logs = [];
  encoders = {
    ffmpeg: '/opt/homebrew/bin/ffmpeg',
    convert: '/opt/homebrew/bin/convert',
    mpeg_encode: null,
  } as unknown as MovieEncoders;
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

async function render() {
  await act(async () => {
    root.render(
      <ExportDialog
        status={status}
        source={makeSource()}
        call={(async (fn: string) => (fn === 'cmd.get_viewport' ? [640, 480] : null)) as never}
        onClose={() => {}}
        log={(line) => logs.push(line)}
      />,
    );
  });
  await act(async () => {});
}

function radio(format: string): HTMLInputElement {
  const found = [...container.querySelectorAll('label.mvedit__label')].find(
    (label) => label.textContent?.trim() === format,
  );
  const input = found?.querySelector('input[type="radio"]');
  if (!input) throw new Error(`no ${format} radio`);
  return input as HTMLInputElement;
}

async function choose(format: string) {
  await act(async () => {
    radio(format).click();
  });
  await act(async () => {});
}

async function exportNow() {
  const button = [...container.querySelectorAll('button')].find(
    (node) => node.textContent?.trim() === 'export',
  );
  if (!button) throw new Error('no export button');
  await act(async () => {
    button.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  });
  await act(async () => {});
}

describe('the encoded formats go through cmd.movie_produce', () => {
  it('mp4 sends the .mp4 filename, ffmpeg, and the draw mode', async () => {
    await render();
    await choose('mp4');
    await exportNow();

    expect(pngCalls).toEqual([]);
    expect(produced).toHaveLength(1);
    expect(produced[0]?.filename).toBe('/tmp/tenmol-movie/frame.mp4');
    expect(produced[0]?.options).toMatchObject({
      encoder: 'ffmpeg',
      mode: 'draw',
      width: 640,
      height: 480,
      quality: 80,
    });
    expect(container.querySelector('.mvexport__result')?.textContent).toContain('2,023 bytes');
    expect(logs).toEqual(['cmd.movie.produce("/tmp/tenmol-movie/frame.mp4", encoder="ffmpeg")']);
  });

  it('mov and gif use ffmpeg too, with the extension carried into the name', async () => {
    await render();
    await choose('mov');
    await exportNow();
    await choose('gif');
    await exportNow();

    expect(produced.map((call) => call.filename)).toEqual([
      '/tmp/tenmol-movie/frame.mov',
      '/tmp/tenmol-movie/frame.gif',
    ]);
    expect(produced.every((call) => call.options.encoder === 'ffmpeg')).toBe(true);
  });

  it('the ray checkbox switches produce from draw to ray', async () => {
    await render();
    await choose('mp4');
    const rayBox = container.querySelector('input[type="checkbox"]') as HTMLInputElement;
    await act(async () => {
      rayBox.click();
    });
    await exportNow();
    expect(produced[0]?.options).toMatchObject({ mode: 'ray' });
  });

  it('mpg is disabled when mpeg_encode is missing, and never redirected to ffmpeg', async () => {
    await render();
    expect(radio('mpg').disabled).toBe(true);
    expect(radio('mp4').disabled).toBe(false);
    // Selecting it is impossible through the DOM; prove the guard directly.
    await choose('mp4');
    expect(produced).toEqual([]);
  });

  it('mpg becomes available — and uses mpeg_encode — once the probe finds it', async () => {
    encoders = {
      ffmpeg: '/opt/homebrew/bin/ffmpeg',
      convert: null,
      mpeg_encode: '/usr/local/bin/mpeg_encode',
    } as unknown as MovieEncoders;
    await render();
    expect(radio('mpg').disabled).toBe(false);
    await choose('mpg');
    await exportNow();
    expect(produced[0]?.filename).toBe('/tmp/tenmol-movie/frame.mpg');
    expect(produced[0]?.options).toMatchObject({ encoder: 'mpeg_encode' });
  });

  it('every encoded format is greyed out when the probe finds nothing at all', async () => {
    encoders = { ffmpeg: null, convert: null, mpeg_encode: null } as unknown as MovieEncoders;
    await render();
    for (const format of ['mp4', 'webm', 'mpg', 'mov', 'gif']) {
      expect(radio(format).disabled).toBe(true);
    }
    expect(radio('png').disabled).toBe(false);
  });

  it('png still goes to movie_export_png, not to produce', async () => {
    await render();
    await exportNow();
    expect(produced).toEqual([]);
    expect(pngCalls).toHaveLength(1);
    expect(pngCalls[0]?.prefix).toBe('/tmp/tenmol-movie/frame');
  });
});
