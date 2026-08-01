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
 */

import { useEffect, useState } from 'react';
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

  if (mode === 0 || lines.length === 0) return null;

  const flush = mode === 3;
  const backdrop = mode === 1;

  const node = (
    <div
      className={'wizprompt' + (backdrop ? ' wizprompt--backdrop' : '')}
      data-testid="wizard-prompt"
      style={{
        top: flush ? 1 : WIZARD_MARGIN,
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
