/**
 * The `.pwg` refusal at its real call site (inventory row 298).
 *
 * `wfFiles.test.ts` pins the pure decision. This pins the WIRING, because the
 * pure decision existing is not what protects anyone: the window-level drop
 * handler used to classify a dropped file, ask `dialogNeededFor` and then send
 * `load <path>` — and a `.pwg` classifies as `plain`, so it went straight
 * through to `cmd.load`, which EXECUTES it (measured in
 * `bridge/tests/test_wf_files.py`: a `.pwg` containing only the word `delete`
 * deleted itself). A drag-and-drop from a web page is exactly how a hostile
 * `.pwg` would arrive.
 */

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { FileDropTarget } from './FileDropTarget';

const appendClient = vi.fn();
const run = vi.fn().mockResolvedValue(undefined);
const call = vi.fn();
const SESSION = {
  call,
  run,
  // `on`/`sub`: `FileDropTarget` mounts `PluginDialogHost`, which subscribes to
  // the `dialog` topic instead of polling (row 295).
  conn: { do: vi.fn(), on: () => () => {}, sub: () => Promise.resolve() },
  stores: { feedback: { appendClient } },
};
vi.mock('../../app', () => ({ useSession: () => SESSION }));

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

let container: HTMLDivElement;
let root: Root;

/** jsdom has no DataTransfer; the handler only reads these two members. */
function transfer(uri: string): DataTransfer {
  return {
    getData: (type: string) => (type === 'text/uri-list' ? uri : ''),
    files: [] as unknown as FileList,
  } as unknown as DataTransfer;
}

function drop(uri: string) {
  const event = new Event('drop', { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'dataTransfer', { value: transfer(uri) });
  window.dispatchEvent(event);
}

/** Let the handler's promise chain settle. */
const settle = () => act(async () => void (await Promise.resolve()));

beforeEach(() => {
  appendClient.mockClear();
  run.mockClear();
  call.mockReset();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root.render(<FileDropTarget />));
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe('dropping a file the client refuses', () => {
  it('never sends `load` for a .pwg, and says why', async () => {
    call.mockResolvedValue({
      filename: 'https://evil.example/app.pwg',
      dialog: 'plain',
      unavailable: null,
      refused: "'.pwg' is refused by the web client. A .pwg file is a script…",
    });

    drop('https://evil.example/app.pwg');
    await settle();
    await settle();

    expect(call).toHaveBeenCalledWith('cmd.tenmol_files.classify', [
      'https://evil.example/app.pwg',
    ]);
    expect(run).not.toHaveBeenCalled();
    expect(appendClient).toHaveBeenCalledWith(
      expect.stringContaining('refused by the web client'),
      'warning',
    );
  });

  it('never sends `load` for a format that raises in this build', async () => {
    // `.stl` classifies as `plain` too, and used to reach `cmd.load` and throw
    // IncentiveOnlyException into the console with no explanation.
    call.mockResolvedValue({
      filename: 'https://h/x.stl',
      dialog: 'plain',
      unavailable: 'stl is Incentive-only in this build',
      refused: null,
    });

    drop('https://h/x.stl');
    await settle();
    await settle();

    expect(run).not.toHaveBeenCalled();
    expect(appendClient).toHaveBeenCalledWith(
      expect.stringContaining('Incentive-only'),
      'warning',
    );
  });

  it('still loads an ordinary structure', async () => {
    call.mockResolvedValue({
      filename: 'https://files.rcsb.org/download/1RX1.pdb',
      dialog: 'plain',
      unavailable: null,
      refused: null,
    });

    drop('https://files.rcsb.org/download/1RX1.pdb');
    await settle();
    await settle();

    expect(run).toHaveBeenCalledWith('load https://files.rcsb.org/download/1RX1.pdb');
  });
});
