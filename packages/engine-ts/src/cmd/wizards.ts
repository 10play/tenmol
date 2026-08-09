/**
 * The `wizards` command subsystem — PyMOL's interactive wizard stack.
 *
 * Ports the `cmd.*_wizard` family that drives the modal helpers in the GUI
 * (`packages/engine/modules/pymol/wizarding.py`,
 * `packages/engine/layer4/Cmd.cpp` `SetWizard`/`SetWizardStack`). PyMOL keeps a
 * LIFO stack of wizard objects in `OrthoWizard`; the active wizard is the top of
 * the stack, contributes the on-screen prompt lines, and can be pushed, popped,
 * or replaced in place.
 *
 * A real wizard is a Python object with `get_prompt()` / event callbacks. Here a
 * wizard is a small serialisable record `{ name, prompt, state }` — enough to
 * reproduce the stack bookkeeping and the prompt readout the console exercises.
 * The heavyweight per-wizard interaction (atom picking, sculpting, …) is not
 * ported; only the stack machine and prompt plumbing are.
 */

import type { Json, JsonObject } from '@tenmol/protocol';
import type { RegistrarCtx } from './registrar';

/** One entry on the wizard stack. `state` is the wizard's opaque scratch data. */
interface Wizard {
  name: string;
  prompt: string[];
  state: JsonObject;
}

/**
 * Default on-screen prompt lines per wizard kind, mirroring the first line each
 * PyMOL wizard's `get_prompt()` returns on activation
 * (`packages/engine/modules/pymol/wizard/*.py`). Unknown kinds fall back to a
 * generic banner.
 */
const DEFAULT_PROMPTS: Readonly<Record<string, string[]>> = {
  measurement: ['Pick atoms to measure distances, angles, and dihedrals.'],
  pair_fit: ['Please pick an atom in the mobile object.'],
  density: ['Please pick a map object to contour.'],
  mutagenesis: ['Pick a residue to mutate.'],
  label: ['Pick atoms to label.'],
  filter: ['Please classify each molecule.'],
  cleanup: ['Pick atoms to clean up.'],
  charge: ['Pick atoms to assign a charge.'],
  sculpting: ['Pick atoms to sculpt.'],
  distance: ['Pick two atoms to measure a distance.'],
};

/** Build a fresh wizard record of the given kind with its default prompt. */
function makeWizard(name: string): Wizard {
  const prompt = DEFAULT_PROMPTS[name];
  return {
    name,
    prompt: prompt ? [...prompt] : [`Wizard: ${name}`],
    state: {},
  };
}

/** A defensive, JSON-safe copy of a wizard (never leak the live reference). */
function copyWizard(w: Wizard): Wizard {
  return { name: w.name, prompt: [...w.prompt], state: { ...w.state } };
}

/**
 * Coerce one element of a `set_wizard_stack` payload into a wizard. Accepts a
 * bare name string (`"measurement"`) or a full `{ name, prompt?, state? }`
 * record. Anything unusable is skipped by the caller.
 */
function coerceWizard(v: unknown): Wizard | null {
  if (typeof v === 'string') return v ? makeWizard(v) : null;
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>;
    const name = o['name'];
    if (typeof name !== 'string' || !name) return null;
    const base = makeWizard(name);
    if (Array.isArray(o['prompt'])) {
      base.prompt = o['prompt'].filter((x): x is string => typeof x === 'string');
    }
    if (o['state'] && typeof o['state'] === 'object' && !Array.isArray(o['state'])) {
      base.state = { ...(o['state'] as JsonObject) };
    }
    return base;
  }
  return null;
}

/** Whether a `replace` flag argument is truthy (accepts `1`, `"1"`, `true`). */
function truthy(v: unknown): boolean {
  if (v == null) return false;
  if (typeof v === 'number') return v !== 0;
  if (typeof v === 'boolean') return v;
  const s = String(v).trim().toLowerCase();
  return s !== '' && s !== '0' && s !== 'false' && s !== 'none';
}

export function registerWizards(ctx: RegistrarCtx): void {
  /** The LIFO wizard stack; the top (last element) is the active wizard. */
  const stack: Wizard[] = [];

  const top = (): Wizard | undefined => (stack.length ? stack[stack.length - 1] : undefined);

  /**
   * `cmd.wizard(name, ...)` — instantiate and push a wizard of kind `name`.
   * A falsy/omitted name clears the active wizard (PyMOL: `wizard()` with no
   * name calls `set_wizard()`). Returns the active wizard's name, or None.
   */
  ctx.command('wizard', (args) => {
    const raw = args[0];
    const name = raw == null ? '' : String(raw);
    if (!name || name.toLowerCase() === 'none') {
      stack.pop();
    } else {
      stack.push(makeWizard(name));
    }
    const t = top();
    return t ? t.name : null;
  });

  /**
   * `cmd.set_wizard(wizard=None, replace=0)` — push `wizard` onto the stack, or
   * (with `replace`) overwrite the top in place. A None wizard pops the top;
   * popping past empty leaves None active.
   */
  ctx.command('set_wizard', (args, kwargs) => {
    const raw = 'wizard' in kwargs ? kwargs['wizard'] : args[0];
    const replace = truthy('replace' in kwargs ? kwargs['replace'] : args[1]);
    const w = raw == null || raw === '' ? null : coerceWizard(raw);
    if (!w) {
      // None => drop the active wizard.
      stack.pop();
    } else if (replace && stack.length) {
      stack[stack.length - 1] = w;
    } else {
      stack.push(w);
    }
    return null;
  });

  /**
   * `cmd.replace_wizard(old, new)` — swap the active wizard for a fresh one of
   * kind `new`, but only when the current top is of kind `old` (PyMOL guards the
   * replacement on the outgoing wizard's identity).
   */
  ctx.command('replace_wizard', (args) => {
    const oldName = args[0] == null ? '' : String(args[0]);
    const newName = args[1] == null ? '' : String(args[1]);
    const t = top();
    if (t && t.name === oldName && newName) {
      stack[stack.length - 1] = makeWizard(newName);
    }
    return top()?.name ?? null;
  });

  /** `cmd.get_wizard()` — the active wizard's name, or None when empty. */
  ctx.command('get_wizard', () => {
    const t = top();
    return t ? t.name : null;
  });

  /** `cmd.get_wizard_prompt()` — the active wizard's prompt lines, or None. */
  ctx.command('get_wizard_prompt', () => {
    const t = top();
    return t ? [...t.prompt] : null;
  });

  /** `cmd.refresh_wizard()` — redraw hook; no state change in this port. */
  ctx.command('refresh_wizard', () => null);

  /** `cmd.get_wizard_stack()` — the whole stack, bottom-to-top, as records. */
  ctx.command('get_wizard_stack', () => stack.map(copyWizard) as unknown as Json);

  /**
   * `cmd.set_wizard_stack(stack)` — replace the entire stack. Elements may be
   * wizard names or `{ name, prompt?, state? }` records; unusable entries drop.
   */
  ctx.command('set_wizard_stack', (args, kwargs) => {
    const raw = 'stack' in kwargs ? kwargs['stack'] : args[0];
    stack.length = 0;
    if (Array.isArray(raw)) {
      for (const el of raw) {
        const w = coerceWizard(el);
        if (w) stack.push(w);
      }
    }
    return null;
  });
}
