/**
 * The wizard prompt overlay.
 *
 * `WizardRefresh` calls `get_prompt()` (`layer1/Wizard.cpp:205`) and hands the
 * lines to `OrthoSetWizardPrompt`; `OrthoDrawWizardPrompt`
 * (`layer1/Ortho.cpp:2124-2218`) draws them at the TOP-LEFT of the viewport,
 * driven by the global setting `wizard_prompt_mode` (default 1,
 * `layer1/SettingInfo.h:461`):
 *
 *   0  suppressed entirely            (`Ortho.cpp:2142`)
 *   1  text + opaque backdrop rect    (`:2193-2218`, WizardBackColor 0.2,0.2,0.2)
 *   2  text only, still inset by cWizardTopMargin/cWizardLeftMargin = 15/15
 *   3  text only, flush to the corner (`:2186-2190`, `top -= 1; left = 1`)
 *
 * Default text colour is WizardTextColor (0.2, 1.0, 0.2) = rgb(51,255,51)
 * (`Ortho.cpp:2695-2697`). Individual lines may override it with `\RGB`.
 *
 * It renders into the viewport region through a portal rather than into this
 * feature's own slot, because the slot lives in the right-hand internal-GUI
 * column and PyMOL draws the prompt over the scene. The portal target is the
 * shell's `.shell__viewport`; if that element is absent (a test harness, a
 * future layout) the prompt falls back to rendering in place instead of
 * disappearing.
 *
 * THE SEQUENCE VIEWER OFFSET (`Ortho.cpp:2178-2184`):
 *
 *     rect.top = I->Height;
 *     if (I->HaveSeqViewer && !SettingGetGlobal_b(G, cSetting_seq_view_location))
 *       rect.top -= SeqGetHeight(G);
 *
 * i.e. a sequence viewer AT THE TOP (`seq_view_location` 0) pushes the prompt
 * down by its own height, and one at the bottom does not. Both blocks live in
 * the same absolutely-positioned viewport region here, so the offset is the
 * measured height of `.seqview.seqview--top` inside the portal host. It is
 * measured rather than recomputed because `SeqGetHeight` is the block's real
 * height (`Seq.cpp:282-289`: rows * LineHeight, plus the scroll bar, and 0
 * while `seq_view_overlay` reserves no space) and the DOM already knows it.
 * The C checks `HaveSeqViewer` only, NOT `seq_view_overlay`, and so does this:
 * an overlaid viewer still displaces the prompt.
 */

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ColorCodedText } from './ColorCodedText';

/** `cWizardTopMargin` / `cWizardLeftMargin` (`layer1/Ortho.cpp:200-201`). */
export const WIZARD_MARGIN = 15;
/** `WizardTextColor` (`layer1/Ortho.cpp:2695-2697`). */
export const WIZARD_TEXT_COLOR = 'rgb(51, 255, 51)';
/** `WizardBackColor` (`layer1/Ortho.cpp:2692-2694`). */
export const WIZARD_BACK_COLOR = 'rgb(51, 51, 51)';

export interface WizardPromptProps {
  lines: string[];
  /** Setting `wizard_prompt_mode`. */
  mode: number;
  /** Portal target selector; the shell's viewport region by default. */
  target?: string;
}

export function WizardPrompt({ lines, mode, target = '.shell__viewport' }: WizardPromptProps) {
  const host = usePortalHost(target);
  const seqHeight = useTopSeqViewerHeight(host);

  if (mode === 0 || lines.length === 0) return null;

  const flush = mode === 3;
  const backdrop = mode === 1;

  const node = (
    <div
      className={'wizprompt' + (backdrop ? ' wizprompt--backdrop' : '')}
      data-testid="wizard-prompt"
      data-seq-offset={seqHeight}
      style={{
        top: (flush ? 1 : WIZARD_MARGIN) + seqHeight,
        left: flush ? 1 : WIZARD_MARGIN,
        color: WIZARD_TEXT_COLOR,
        background: backdrop ? WIZARD_BACK_COLOR : 'transparent',
      }}
    >
      {lines.map((line, index) => (
        <div className="wizprompt__line" key={index}>
          <ColorCodedText text={line} />
        </div>
      ))}
    </div>
  );

  return host ? createPortal(node, host) : node;
}

function usePortalHost(selector: string): Element | null {
  const [host, setHost] = useState<Element | null>(null);
  useEffect(() => {
    // After mount, so the shell's own DOM already exists.
    setHost(document.querySelector(selector));
  }, [selector]);
  return host;
}

/** Selector for the sequence-viewer block when it is at the TOP of the viewport. */
export const SEQ_TOP_SELECTOR = '.seqview.seqview--top';

/**
 * The height of a top-anchored sequence viewer inside `host`, or 0.
 *
 * The viewer mounts, unmounts, changes row count and flips between top and
 * bottom while the wizard is open, and every one of those changes moves the
 * prompt in the C build. A `MutationObserver` over the host covers appear /
 * disappear / class flip; a `ResizeObserver`, when the platform has one,
 * covers "same element, more rows".
 */
export function useTopSeqViewerHeight(host: Element | null): number {
  const [height, setHeight] = useState(0);
  const last = useRef(0);

  useEffect(() => {
    if (!host) {
      last.current = 0;
      setHeight(0);
      return;
    }
    // `last` mirrors `height`: the observers fire for the prompt's OWN
    // insertion into the host too, and an unchanged measurement must not
    // become a React update (it would warn out of `act` and re-render).
    const measure = () => {
      const seq = host.querySelector(SEQ_TOP_SELECTOR);
      const next = seq ? Math.round(seq.getBoundingClientRect().height) : 0;
      if (next === last.current) return;
      last.current = next;
      setHeight(next);
    };
    measure();

    const mutation = new MutationObserver(measure);
    mutation.observe(host, { childList: true, subtree: true, attributes: true });

    const Resize = (globalThis as { ResizeObserver?: typeof ResizeObserver }).ResizeObserver;
    const resize = Resize ? new Resize(measure) : null;
    if (resize) resize.observe(host);

    return () => {
      mutation.disconnect();
      resize?.disconnect();
    };
  }, [host]);

  return height;
}
