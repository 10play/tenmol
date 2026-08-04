/**
 * The `mset` mini-language, ported for PREVIEW ONLY.
 *
 * `cmd.mset` is parsed entirely in Python (`packages/engine/modules/pymol/moving.py:691-763`)
 * and hands `_cmd.mset` a space-separated list of **0-based** states. This is a
 * line-for-line port of that loop so the editor can show the resulting
 * frame->state table before the user commits.
 *
 * THE RAW STRING IS ALWAYS WHAT GOES OVER THE WIRE. Nothing here is ever used
 * to build the command: if this port and PyMOL ever disagree, PyMOL wins and
 * the preview is simply wrong for one keystroke.
 *
 * Grammar, from that loop:
 *   `N`   one frame of state N          `val = N-1; last = val`
 *   `xN`  repeat the previous state to N frames total; with no previous state
 *         it repeats the CURRENT state N times (`last<0 -> last = cur_state`,
 *         `cnt = N`, otherwise `cnt = N-1`)
 *   `-N`  ramp from the previous state to N **inclusive**, direction chosen
 *         automatically (`dir = last<cnt ? -1 : 1`, emitting `cnt+dir` until
 *         `cnt === last`)
 *
 * The tokenizer is the same four `replace`s: whitespace collapses to a space,
 * `x` and `-` each get a space in front, and then a space *after* either of
 * them is removed again so `1 x 10` and `1x10` are one token.
 */

import type { MsetPreview, MsetToken } from '@tenmol/protocol/topics/movie';

/** `packages/engine/modules/pymol/moving.py:731-737`. */
export function tokenizeMset(specification: string): string[] {
  let input = specification.replace(/\s/g, ' ');
  input = input.replace(/x/g, ' x');
  input = input.replace(/-/g, ' -');
  input = input.replace(/x /g, 'x');
  input = input.replace(/- /g, '-');
  return input.trim().split(/ +/).filter(Boolean);
}

/**
 * Run the parser.
 *
 * @param specification the raw `mset` argument
 * @param currentState  1-based `cmd.get_state()` — PyMOL uses `get_state()-1`
 *                      as the seed for a leading `xN`
 * @returns 1-based states, one per frame; `error` is set (and `states` holds
 *          everything parsed so far) when a token is not a number
 */
export function previewMset(specification: string, currentState = 1): MsetPreview {
  const tokens: MsetToken[] = [];
  const output: number[] = []; // 0-based, exactly like PyMOL's `output`
  const curState = Math.max(0, Math.trunc(currentState) - 1);
  let last = -1;
  let error: string | null = null;

  for (const token of tokenizeMset(specification)) {
    const head = token[0] ?? '';
    if (head >= '0' && head <= '9') {
      const value = Number.parseInt(token, 10);
      if (!Number.isFinite(value)) {
        error = `not a number: ${token}`;
        break;
      }
      const zero = value - 1;
      output.push(zero);
      last = zero;
      tokens.push({ kind: 'state', state: value });
      continue;
    }

    if (head === 'x') {
      const total = Number.parseInt(token.slice(1), 10);
      if (!Number.isFinite(total)) {
        error = `not a repeat count: ${token}`;
        break;
      }
      let count: number;
      if (last < 0) {
        last = curState;
        count = total;
      } else {
        count = total - 1;
      }
      while (count > 0) {
        output.push(last);
        count -= 1;
      }
      tokens.push({ kind: 'repeat', total });
      continue;
    }

    if (head === '-') {
      const to = Number.parseInt(token.slice(1), 10);
      if (!Number.isFinite(to)) {
        error = `not a ramp target: ${token}`;
        break;
      }
      let direction = 1;
      let cursor = last;
      last = to - 1;
      if (last < cursor) direction = -1;
      // Guard the one shape PyMOL cannot hit but a half-typed string can:
      // `cursor === last` terminates immediately, anything else walks by one.
      let guard = 0;
      while (cursor !== last && guard < 1_000_000) {
        cursor += direction;
        output.push(cursor);
        guard += 1;
      }
      tokens.push({ kind: 'ramp', to });
      continue;
    }

    error = `unexpected token: ${token}`;
    break;
  }

  return { states: output.map((state) => state + 1), tokens, error };
}
