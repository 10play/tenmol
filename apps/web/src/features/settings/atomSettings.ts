/**
 * The `s` SettingWrapper as a write path — `cmd.alter` / `cmd.alter_state`.
 *
 * WHY THIS EXISTS. `cmd.set(name, value, selection)` reaches the ATOM level and
 * stops there. There is no `cmd.set` spelling that reaches the ATOM-STATE
 * level at all: `SettingWrapper` is bound to `(atom)` inside `alter` and to
 * `(atom, state)` inside `alter_state` (`layer1/P.cpp:455-606`), and the
 * atom-state table is a different `SettingUnique` keyed by the coordinate, so
 * the 17 atom-state settings (`label_position`, `label_screen_point`,
 * `label_bg_color`, …) are unreachable from every other API the client has.
 * `modules/pymol/setting.py:519-526` documents exactly one escape hatch for
 * them, and it is this one:
 *
 *     alter_state 1, *, del s[728]
 *
 * MEASURED over the WebSocket, `bridge/tests/test_p8_a5.py`:
 *
 *     alter       "p8x and name CA", "s['sphere_scale']=3.5"          -> 1
 *     alter_state 1, "p8x and name CB", "s['label_screen_point']=…"   -> 1
 *     alter_state 1, "p8x and name CB", "del s['label_screen_point']" -> 1
 *
 * and the result is the ATOM COUNT the expression ran on, which is the only
 * acknowledgement the client gets — `iterate` does not hand a value back over
 * JSON, so a write that matched nothing (`0`) has to be surfaced as such.
 *
 * DANGEROUS, and it should be. The bridge logs both verbs as
 * `alter (evaluates a Python expression per atom)`. That is why the expression
 * is BUILT here from a typed literal rather than taken from the user: the value
 * box holds a value, never a Python fragment.
 */

import type { SettingKind, SettingMeta } from '@tenmol/protocol';

export type AtomScope = 'atom' | 'atom-state';

export interface AtomSettingWrite {
  /** The wire `fn`. */
  fn: 'alter' | 'alter_state';
  args: readonly unknown[];
  /** What to echo into the feedback pane, spelled as a user would type it. */
  echo: string;
  /** The expression, exposed so the table can show it before it runs. */
  expression: string;
}

/**
 * A value as a Python literal for the `s[...] = …` right-hand side.
 *
 * `SettingWrapper::__setitem__` funnels into `SettingSetFromPyObject`
 * (`layer1/Setting.cpp`), which switches on the setting's declared type — an
 * int for `cSetting_boolean`/`int`/`color`, a float, or a 3-tuple. It does NOT
 * do PyMOL's command-line coercion, so `'on'`, `'red'` and `[1,2,3]` all have
 * to be turned into the right Python object here.
 *
 * Colour: a NAME is kept as a string. `SettingSetFromPyObject` for
 * `cSetting_color` accepts a string and resolves it through `ColorGetIndex`,
 * which is the only way `s['label_bg_color']='tv_red'` can work — and it is
 * measured to work (`test_p8_a5.py::test_atom_state_colour_takes_a_name`).
 */
export function pythonLiteral(kind: SettingKind, raw: unknown): string {
  if (kind === 'float3') return float3Literal(raw);
  if (kind === 'string') return quote(String(raw));
  if (kind === 'color') {
    const text = String(raw).trim();
    return /^-?\d+$/.test(text) ? text : quote(text);
  }
  if (kind === 'boolean') return booleanLiteral(raw) ? '1' : '0';
  const n = Number(raw);
  if (!Number.isFinite(n)) throw new Error(`${String(raw)} is not a number`);
  if (kind === 'int') return String(Math.trunc(n));
  // A float literal must not lose its decimal point: `s[k]=1` on a float
  // setting is still fine in C, but the echoed line should read like the
  // setting's type.
  return Number.isInteger(n) ? `${n}.0` : String(n);
}

function booleanLiteral(raw: unknown): boolean {
  if (typeof raw === 'boolean') return raw;
  const text = String(raw).trim().toLowerCase();
  if (text === '' || text === '0' || text === 'off' || text === 'false' || text === 'no') {
    return false;
  }
  const n = Number(text);
  return Number.isFinite(n) ? n !== 0 : true;
}

function float3Literal(raw: unknown): string {
  const parts = Array.isArray(raw)
    ? raw
    : String(raw)
        .replace(/[[\]()]/g, '')
        .split(/[\s,]+/)
        .filter((s) => s !== '');
  if (parts.length !== 3) throw new Error(`${String(raw)} is not three numbers`);
  const numbers = parts.map((p) => Number(p));
  if (numbers.some((n) => !Number.isFinite(n))) {
    throw new Error(`${String(raw)} is not three numbers`);
  }
  return `(${numbers.map((n) => (Number.isInteger(n) ? `${n}.0` : String(n))).join(', ')})`;
}

/** Python single-quoted string, with the two characters that can break out escaped. */
function quote(text: string): string {
  return `'${text.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
}

export interface AtomSettingTarget {
  selection: string;
  /** 1-based, as `alter_state` takes it. Ignored for the `atom` scope. */
  state: number;
}

/** `s['name'] = <literal>` inside `alter` (atom) or `alter_state` (atom-state). */
export function atomSettingWrite(
  meta: SettingMeta,
  raw: unknown,
  scope: AtomScope,
  target: AtomSettingTarget,
): AtomSettingWrite {
  const expression = `s[${quote(meta.name)}]=${pythonLiteral(meta.kind, raw)}`;
  return build(expression, scope, target);
}

/**
 * `del s['name']` — the documented escape hatch, and the ONLY way to remove an
 * atom-state override. `cmd.unset` does not reach that level: `unset_deep`
 * covers object / object-state / atom / bond and explicitly not atom-state
 * (`modules/pymol/setting.py:290-322`).
 */
export function atomSettingDelete(
  meta: SettingMeta,
  scope: AtomScope,
  target: AtomSettingTarget,
): AtomSettingWrite {
  return build(`del s[${quote(meta.name)}]`, scope, target);
}

function build(expression: string, scope: AtomScope, target: AtomSettingTarget): AtomSettingWrite {
  const selection = target.selection;
  if (scope === 'atom-state') {
    const state = Math.max(1, Math.trunc(target.state) || 1);
    return {
      fn: 'alter_state',
      args: [state, selection, expression],
      echo: `cmd.alter_state(${state}, ${JSON.stringify(selection)}, ${JSON.stringify(expression)})`,
      expression,
    };
  }
  return {
    fn: 'alter',
    args: [selection, expression],
    echo: `cmd.alter(${JSON.stringify(selection)}, ${JSON.stringify(expression)})`,
    expression,
  };
}

/**
 * What the reply means. `cmd.alter`/`alter_state` return the number of atoms
 * the expression ran on, so 0 is a selection that matched nothing — a silent
 * no-op unless someone says so.
 */
export function describeAtomWriteResult(write: AtomSettingWrite, result: unknown): string {
  const n = typeof result === 'number' ? result : Number(result);
  if (!Number.isFinite(n)) return `${write.fn} returned ${String(result)}`;
  if (n === 0) return `${write.fn}: 0 atoms — the selection matched nothing`;
  return `${write.fn}: ${n} atom${n === 1 ? '' : 's'}`;
}
