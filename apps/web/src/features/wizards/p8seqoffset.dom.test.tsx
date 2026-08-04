/**
 * Wave 8 — the sequence-viewer offset the wizard-prompt row was missing.
 *
 * `OrthoDrawWizardPrompt` (`packages/engine/layer1/Ortho.cpp:2178-2184`) starts the prompt at
 * the top of the viewport and subtracts `SeqGetHeight(G)` when the sequence
 * viewer is present AND `seq_view_location` is 0 (top). Both blocks are
 * absolutely positioned inside `.shell__viewport` in this client, so the
 * offset is the measured height of the top-anchored `.seqview` element.
 *
 * jsdom lays nothing out, so `getBoundingClientRect` is stubbed per element
 * with the height the real block would have; that is the only thing faked
 * here — the plumbing (observers, portal, arithmetic) is the real component.
 */

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { WizardPrompt, WIZARD_MARGIN } from './WizardPrompt';

let container: HTMLDivElement;
let root: Root;
let viewport: HTMLDivElement;

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  viewport = document.createElement('div');
  viewport.className = 'shell__viewport';
  document.body.appendChild(viewport);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  viewport.remove();
});

function render(node: React.ReactNode) {
  act(() => root.render(node));
}

/** A sequence-viewer block of `height` px, at the top or the bottom. */
function addSeqViewer(height: number, where: 'top' | 'bottom'): HTMLDivElement {
  const seq = document.createElement('div');
  seq.className = `seqview seqview--${where}`;
  seq.getBoundingClientRect = () =>
    ({ height, width: 400, top: 0, left: 0, right: 400, bottom: height, x: 0, y: 0 }) as DOMRect;
  viewport.appendChild(seq);
  return seq;
}

function promptTop(): string {
  const el = viewport.querySelector('[data-testid="wizard-prompt"]') as HTMLElement;
  return el.style.top;
}

function promptOffset(): string | null {
  const el = viewport.querySelector('[data-testid="wizard-prompt"]') as HTMLElement;
  return el.getAttribute('data-seq-offset');
}

describe('WizardPrompt sequence-viewer offset', () => {
  it('sits at the plain margin when there is no sequence viewer', () => {
    render(<WizardPrompt lines={['Please click on the first atom...']} mode={1} />);
    expect(promptTop()).toBe(`${WIZARD_MARGIN}px`);
    expect(promptOffset()).toBe('0');
  });

  it('is pushed down by the height of a TOP sequence viewer', () => {
    addSeqViewer(42, 'top');
    render(<WizardPrompt lines={['Please click on the first atom...']} mode={1} />);
    expect(promptOffset()).toBe('42');
    expect(promptTop()).toBe(`${WIZARD_MARGIN + 42}px`);
  });

  it('is NOT pushed down by a bottom sequence viewer (seq_view_location 1)', () => {
    addSeqViewer(42, 'bottom');
    render(<WizardPrompt lines={['x']} mode={1} />);
    expect(promptOffset()).toBe('0');
    expect(promptTop()).toBe(`${WIZARD_MARGIN}px`);
  });

  it('offsets mode 3 from its 1 px corner too', () => {
    addSeqViewer(30, 'top');
    render(<WizardPrompt lines={['x']} mode={3} />);
    expect(promptTop()).toBe('31px');
  });

  it('follows the viewer appearing, growing and moving to the bottom', async () => {
    render(<WizardPrompt lines={['x']} mode={2} />);
    expect(promptTop()).toBe(`${WIZARD_MARGIN}px`);

    const seq = addSeqViewer(26, 'top');
    await flushObservers();
    expect(promptTop()).toBe(`${WIZARD_MARGIN + 26}px`);

    // one more sequence row: SeqGetHeight grows by LineHeight (13)
    seq.getBoundingClientRect = () =>
      ({ height: 39, width: 400, top: 0, left: 0, right: 400, bottom: 39, x: 0, y: 0 }) as DOMRect;
    seq.setAttribute('data-rows', '2'); // an attribute change the observer sees
    await flushObservers();
    expect(promptTop()).toBe(`${WIZARD_MARGIN + 39}px`);

    seq.className = 'seqview seqview--bottom';
    await flushObservers();
    expect(promptTop()).toBe(`${WIZARD_MARGIN}px`);

    seq.remove();
    await flushObservers();
    expect(promptTop()).toBe(`${WIZARD_MARGIN}px`);
  });
});

/** MutationObserver callbacks are microtasks; let React commit after them. */
async function flushObservers(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}
