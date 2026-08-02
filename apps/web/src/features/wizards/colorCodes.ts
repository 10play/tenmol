/**
 * PyMOL's inline text colour markup, `\RGB`.
 *
 * `TextStartsWithColorCode` (`packages/engine/layer1/Text.cpp:507-521`): a code is a backslash
 * followed by **three digits 0-9**, or by `---` which resets to the default
 * colour. `TextSetColorFromCode` (`:530-548`) maps each digit `d` to `d / 9.0`.
 * There is no escape and no terminator: the code is exactly four characters and
 * everything after it is text until the next code.
 *
 * Consumers in the C tree: the wizard panel (`Wizard.cpp:670-681`), the wizard
 * prompt (`Ortho.cpp:2165`, `:2237`) and popup width measurement
 * (`PopUp.cpp:194`). Live producers: `appearance.py:38-53` (a `\RGB` swatch on
 * every colour name), `cleanup.py:133` (`\999Ligand:\000 `), `command.py:146`,
 * `renaming.py:12`, `pseudoatom.py:13`, `annotation.py:86-93`.
 *
 * `message.py:7` strips them for the console with `\\[0-9][0-9][0-9]` — note
 * that PyMOL's own stripper misses `\---`, which is why `stripColorCodes` here
 * handles both.
 */

export interface TextSpan {
  text: string;
  /** `null` = default colour (start of string, or after `\---`). */
  color: string | null;
}

const DIGITS = /^[0-9]$/;

/** True when `s[at]` starts a 4-character colour code. */
export function isColorCodeAt(s: string, at: number): boolean {
  if (s[at] !== '\\') return false;
  if (s[at + 1] === '-') return s[at + 2] === '-' && s[at + 3] === '-';
  return (
    DIGITS.test(s[at + 1] ?? '') && DIGITS.test(s[at + 2] ?? '') && DIGITS.test(s[at + 3] ?? '')
  );
}

/** `\900` -> `rgb(255, 0, 0)`. Each digit is `d / 9` of full scale. */
export function colorFromCode(code: string): string | null {
  if (code[1] === '-') return null;
  const channel = (index: number) => Math.round((Number(code[index]) / 9) * 255);
  return `rgb(${channel(1)}, ${channel(2)}, ${channel(3)})`;
}

/**
 * Split a wizard string into coloured spans. Always returns at least one span
 * so a caller can render the result unconditionally.
 */
export function parseColorCodes(input: string): TextSpan[] {
  const spans: TextSpan[] = [];
  let color: string | null = null;
  let buffer = '';

  const flush = () => {
    if (buffer !== '') {
      spans.push({ text: buffer, color });
      buffer = '';
    }
  };

  for (let i = 0; i < input.length; ) {
    if (isColorCodeAt(input, i)) {
      flush();
      color = colorFromCode(input.slice(i, i + 4));
      i += 4;
      continue;
    }
    buffer += input[i];
    i += 1;
  }
  flush();
  return spans.length > 0 ? spans : [{ text: '', color: null }];
}

/** The plain text, codes removed — for `title=`, `aria-label` and tests. */
export function stripColorCodes(input: string): string {
  return parseColorCodes(input)
    .map((span) => span.text)
    .join('');
}
