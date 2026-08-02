/**
 * The drag-enter live preview under PROTECTED MODE — parity row 56.
 *
 * The row's gap sentence, unchanged for four waves: "for a drag originating
 * OUTSIDE the page the HTML5 data store is in protected mode, so there is no
 * live preview — the drop still inserts." The clause is right about the
 * payload and wrong about the conclusion: `dataTransfer.types` and
 * `dataTransfer.items[i].kind` ARE readable during `dragenter`, so the drag can
 * be previewed even though it cannot be READ. What is not achievable is Qt's
 * exact text (the file's name is withheld until `drop` in every engine), and
 * that deviation is stated in `dragPreview.ts` rather than hidden.
 *
 * The events below model a real Finder drag as Chromium presents it:
 * `types = ['Files', 'text/uri-list']`, `items` reporting one entry of kind
 * `file`, `getData()` returning `''` for everything, `files` EMPTY — and then a
 * `drop` where all of it becomes readable at once.
 */

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createConnectionStore,
  createFeedbackStore,
  createObjectsStore,
  createUiStore,
} from '@tenmol/stores';
import { SessionContext, type Session } from '../../app';
import { CommandLine } from './CommandLine';
import { PLACEHOLDER_PATTERN, protectedPlaceholder } from './dragPreview';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;
let session: Session;

function makeSession(): Session {
  const connection = createConnectionStore('ws://test/ws', true);
  connection.set({ phase: 'open' });
  return {
    config: {} as Session['config'],
    conn: {
      isOpen: true,
      sendInput: vi.fn(),
      do: () => Promise.resolve(),
    },
    stores: {
      connection,
      feedback: createFeedbackStore(),
      objects: createObjectsStore(),
      ui: createUiStore(null),
    },
    objectsSource: { poll: vi.fn(), invalidate: vi.fn() },
    poller: { stats: () => ({ hz: 30 }) },
    run: vi.fn(() => Promise.resolve()),
    act: vi.fn(),
    call: vi.fn(() => Promise.resolve(null)),
    reconnect: vi.fn(),
    disconnect: vi.fn(),
    useToken: vi.fn(),
    probeHealth: vi.fn(),
  } as unknown as Session;
}

/* ------------------------------------------------------------------ *
 * A DataTransfer with a protected mode
 * ------------------------------------------------------------------ */

interface FakeTransfer {
  types: string[];
  /** What `getData` answers. Empty for every key while protected. */
  data: Record<string, string>;
  items: Array<{ kind: string; type: string }>;
  files: File[];
}

function transfer(options: Partial<FakeTransfer>): DataTransfer {
  const state: FakeTransfer = {
    types: options.types ?? [],
    data: options.data ?? {},
    items: options.items ?? [],
    files: options.files ?? [],
  };
  return {
    types: state.types,
    items: state.items,
    files: state.files,
    getData: (key: string) => state.data[key] ?? '',
    dropEffect: 'copy',
    effectAllowed: 'all',
  } as unknown as DataTransfer;
}

/** Chromium during `dragenter` for a drag from Finder: types, no payload. */
const PROTECTED_FILE = () =>
  transfer({
    types: ['Files', 'text/uri-list'],
    items: [{ kind: 'file', type: 'chemical/x-pdb' }],
  });

function fire(type: string, dataTransfer: DataTransfer): void {
  const input = container.querySelector('input');
  if (!input) throw new Error('no command line');
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'dataTransfer', { value: dataTransfer });
  act(() => {
    input.dispatchEvent(event);
  });
}

function line(): HTMLInputElement {
  const input = container.querySelector('input');
  if (!input) throw new Error('no command line');
  return input;
}

function typeInto(value: string, cursor = value.length): void {
  const input = line();
  const setter = Object.getOwnPropertyDescriptor(
    Object.getPrototypeOf(input) as object,
    'value',
  )?.set;
  setter?.call(input, value);
  act(() => {
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  act(() => {
    input.setSelectionRange(cursor, cursor);
  });
}

function mount(): void {
  act(() =>
    root.render(
      <SessionContext.Provider value={session}>
        <CommandLine />
      </SessionContext.Provider>,
    ),
  );
}

beforeEach(() => {
  session = makeSession();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe('protectedPlaceholder — what a withheld drag still tells us', () => {
  it('counts files from `items`, because `files` is empty until drop', () => {
    expect(protectedPlaceholder({ types: ['Files'], fileCount: 1 })).toBe('⟨file⟩');
    expect(protectedPlaceholder({ types: ['Files'], fileCount: 3 })).toBe('⟨3 files⟩');
    // Safari reports the type with an empty item list.
    expect(protectedPlaceholder({ types: ['Files'], fileCount: 0 })).toBe('⟨file⟩');
    expect(protectedPlaceholder({ types: ['text/uri-list'], fileCount: 0 })).toBe('⟨link⟩');
    expect(protectedPlaceholder({ types: ['text/plain'], fileCount: 0 })).toBe('⟨text⟩');
  });

  it('is null for a drag this widget cannot accept', () => {
    expect(protectedPlaceholder({ types: [], fileCount: 0 })).toBe(null);
    expect(protectedPlaceholder({ types: ['application/x-moz-node'], fileCount: 0 })).toBe(null);
  });
});

describe('a drag from OUTSIDE the page (row 56)', () => {
  it('previews at the cursor and SELECTS it, as dragEnterEvent does', () => {
    mount();
    typeInto('load ', 5);
    fire('dragenter', PROTECTED_FILE());

    expect(line().value).toBe('load ⟨file⟩');
    // `setSelection(pos, len(droppedtext))` (`pymol_qt_gui.py:1116`).
    expect([line().selectionStart, line().selectionEnd]).toEqual([5, 11]);
    expect(line().value.slice(5, 11)).toMatch(PLACEHOLDER_PATTERN);
  });

  it('restores the original text and cursor on dragleave', () => {
    mount();
    typeInto('load ', 5);
    fire('dragenter', PROTECTED_FILE());
    expect(line().value).toBe('load ⟨file⟩');

    fire('dragleave', PROTECTED_FILE());
    expect(line().value).toBe('load ');
    expect([line().selectionStart, line().selectionEnd]).toEqual([5, 5]);
  });

  it('the drop replaces the stand-in with the real path, not appends to it', () => {
    mount();
    typeInto('load ', 5);
    fire('dragenter', PROTECTED_FILE());
    // Everything becomes readable at `drop` — this is the same drag.
    fire(
      'drop',
      transfer({
        types: ['Files', 'text/uri-list'],
        data: { 'text/uri-list': 'file:///tmp/my%20file.pdb\r\n' },
        files: [],
      }),
    );
    expect(line().value).toBe('load /tmp/my file.pdb');
    // The insert is no longer selected once it is real (`selectInserted` false).
    expect([line().selectionStart, line().selectionEnd]).toEqual([21, 21]);
  });

  it('leaves nothing behind when the drop turns out to carry nothing', () => {
    mount();
    typeInto('load ', 5);
    fire('dragenter', PROTECTED_FILE());
    fire('drop', transfer({ types: ['Files'] }));
    expect(line().value).toBe('load ');
  });

  it('ignores a drag it could not accept at all', () => {
    mount();
    typeInto('load ', 5);
    fire('dragenter', transfer({ types: ['application/x-moz-node'] }));
    expect(line().value).toBe('load ');
    fire('dragleave', transfer({ types: ['application/x-moz-node'] }));
    expect(line().value).toBe('load ');
  });
});

describe('a drag from INSIDE the page is untouched by any of this', () => {
  it('previews the REAL text, exactly as Qt does', () => {
    mount();
    typeInto('load ', 5);
    fire(
      'dragenter',
      transfer({
        types: ['text/plain', 'text/uri-list'],
        data: { 'text/uri-list': 'file:///tmp/1ubq.pdb', 'text/plain': 'file:///tmp/1ubq.pdb' },
        items: [{ kind: 'string', type: 'text/plain' }],
      }),
    );
    expect(line().value).toBe('load /tmp/1ubq.pdb');
    expect([line().selectionStart, line().selectionEnd]).toEqual([5, 18]);
    expect(line().value).not.toMatch(/⟨/u);
  });
});
