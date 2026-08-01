/**
 * The Views panel, driven with the exact bytes the bridge answers.
 *
 * The interesting behaviour here is not the buttons — it is that the list is
 * read out of an ERROR. `pymol._view_dict` has no getter (the dispatcher only
 * invokes callables), so `useViews` fetches by sending a lookup that is
 * guaranteed to miss and parsing `Shortcut.auto_err`'s message. Three things
 * can go wrong with that and all three are tested:
 *
 *  * the probe must go out on a channel that does NOT print to the console, or
 *    every refresh writes a red error line the user did not cause;
 *  * a real transport failure must not read as "zero views" and blank the list;
 *  * every button must send the FULL name, because the key is a prefix.
 */

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ViewList } from './ViewList';
import { VIEW_PROBE_KEY } from './viewActions';

interface Call {
  fn: string;
  args: readonly unknown[];
  kwargs: Record<string, unknown>;
}

const connCalls: Call[] = [];
const acted: Call[] = [];
let listing = "Error: unknown view: 'X'. Choices:\n  alpha  beta   mu   ";
let probeThrows: Error | null = null;

const SESSION = {
  conn: {
    call: vi.fn(async (fn: string, args: readonly unknown[], kwargs: Record<string, unknown>) => {
      connCalls.push({ fn, args, kwargs });
      throw probeThrows ?? new Error(listing);
    }),
  },
  act: vi.fn(async (action: Call) => {
    acted.push(action);
  }),
};
vi.mock('../../app', () => ({ useSession: () => SESSION }));

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  connCalls.length = 0;
  acted.length = 0;
  probeThrows = null;
  listing = "Error: unknown view: 'X'. Choices:\n  alpha  beta   mu   ";
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
    root.render(<ViewList />);
  });
}

function names(): string[] {
  return [...container.querySelectorAll('.vwrow__name')].map((n) => n.textContent ?? '');
}

function click(el: Element | null | undefined, init: MouseEventInit = {}) {
  return act(async () => {
    el?.dispatchEvent(new MouseEvent('click', { bubbles: true, ...init }));
  });
}

/**
 * Type into a CONTROLLED input.
 *
 * Assigning `input.value` directly is invisible to React 19: it installs its
 * own value descriptor on the element and reads the tracked value, so the
 * `input` event arrives with no change and `onChange` never fires. Going
 * through the prototype setter is the documented way round it.
 */
function type(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  setter?.call(input, value);
  return act(async () => {
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

describe('ViewList', () => {
  it('lists the views the failed lookup reported, sorted', async () => {
    await render();
    expect(names()).toEqual(['alpha', 'beta', 'mu']);
    // The probe went out on `conn.call`, NOT `session.call`: the latter writes
    // every rejection into the console scrollback, and this rejection is the
    // fetch mechanism, not a user-visible failure.
    expect(connCalls[0]).toMatchObject({
      fn: 'cmd.view',
      args: [VIEW_PROBE_KEY, 'recall'],
    });
    expect(SESSION.act).not.toHaveBeenCalled();
  });

  it('an empty dict renders as no views, not as an error', async () => {
    listing = "Error: unknown view: 'X'. Choices:\n";
    await render();
    expect(names()).toEqual([]);
    expect(container.querySelector('.vwlist__err')).toBeNull();
  });

  it('a transport failure keeps the panel honest instead of blanking it', async () => {
    probeThrows = new Error('socket closed');
    await render();
    expect(container.querySelector('.vwlist__err')?.textContent).toContain('socket closed');
  });

  it('clicking a name recalls it by its FULL name with animate=-1', async () => {
    await render();
    await click(container.querySelectorAll('.vwrow__name')[0]);
    expect(acted[0]).toMatchObject({
      fn: 'cmd.view',
      args: ['alpha', 'recall'],
      kwargs: { animate: -1 },
    });
  });

  it('ctrl-click recalls with no sweep', async () => {
    await render();
    await click(container.querySelectorAll('.vwrow__name')[1], { ctrlKey: true });
    expect(acted[0]).toMatchObject({ args: ['beta', 'recall'], kwargs: { animate: 0 } });
  });

  it('the row delete button is cmd.view(name, "clear")', async () => {
    await render();
    await click(container.querySelectorAll('.vwrow__del')[2]);
    expect(acted[0]).toMatchObject({ args: ['mu', 'clear'] });
  });

  it('store sends the typed name, and a bad name is refused before it is sent', async () => {
    await render();
    const input = container.querySelector<HTMLInputElement>('.vwlist__name');
    const store = [...container.querySelectorAll('button')].find(
      (b) => b.textContent === 'store',
    );

    // `_x` survives in `_view_dict` but is dropped from the Shortcut index on
    // the next rebuild, so upstream would accept a view that can never be
    // recalled. Refused here, visibly.
    await type(input!, '_hidden');
    await click(store);
    expect(acted).toEqual([]);
    expect(container.querySelector('.vwlist__err')?.textContent).toContain('_');

    await type(input!, 'front');
    await click(store);
    expect(acted[0]).toMatchObject({ fn: 'cmd.view', args: ['front', 'store'] });
    // ...and the list is re-read afterwards, since `store` has no return value
    // that says what the dict now holds.
    expect(connCalls.length).toBeGreaterThan(1);
  });

  it('clear all is the only bulk operation the API has', async () => {
    await render();
    const button = [...container.querySelectorAll('button')].find(
      (b) => b.textContent === 'clear all',
    );
    await click(button);
    expect(acted[0]).toMatchObject({ fn: 'cmd.view', args: ['*', 'clear'] });
  });
});
