/**
 * Renders one wizard string, honouring PyMOL's `\RGB` inline colour markup.
 *
 * Used by every wizard text surface — panel rows, popup items and the prompt —
 * exactly as the C tree does (`Wizard.cpp:670-681`, `Ortho.cpp:2165`,
 * `PopUp.cpp:194`). See `colorCodes.ts` for the grammar.
 */

import { Fragment } from 'react';
import { parseColorCodes, stripColorCodes } from './colorCodes';

export function ColorCodedText({ text, className }: { text: string; className?: string }) {
  const spans = parseColorCodes(text);
  const plain = stripColorCodes(text);

  // No markup: emit the string, not a wrapper full of fragments.
  if (spans.length === 1 && spans[0]?.color == null) {
    return <span className={className}>{plain}</span>;
  }

  return (
    <span className={className} title={plain}>
      {spans.map((span, index) => (
        <Fragment key={index}>
          {span.color === null ? (
            span.text
          ) : (
            <span style={{ color: span.color }}>{span.text}</span>
          )}
        </Fragment>
      ))}
    </span>
  );
}
