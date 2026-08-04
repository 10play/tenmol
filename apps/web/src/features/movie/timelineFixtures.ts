/** Test helper: one call that exercises the whole `mvprg` round trip. */

import { beginProgram, removeLastProgram } from './mvprg';

export function mvprgRoundTrip(
  template: string,
  movieLength: number,
): { command: string; remove: { count: number; frame: number } | null } {
  const { state, command } = beginProgram(template, movieLength);
  return { command, remove: removeLastProgram(state) };
}
