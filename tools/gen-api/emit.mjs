/**
 * Turn `api-schema.json` into a typed TypeScript client surface.
 *
 *     node tools/gen-api/emit.mjs <schema.json> <out.ts>
 *
 * The extractor writes FACTS; every decision about types lives here, so the
 * priority order can change without re-running PyMOL.
 *
 * WHERE THE OUTPUT GOES, and why not where the row says. The inventory row
 * names `packages/pymol-client/src/generated/`. That package does not exist,
 * and creating one means editing the workspace config — a shared file. The
 * generated module lands in `packages/protocol/src/generated/` instead, which
 * is an existing package with no barrel to touch.
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

/**
 * Commands that take a raw Python/PML string or otherwise execute arbitrary
 * text. They are emitted, but into their own section with a warning, because
 * a typed wrapper around `do` is a typed wrapper around "run anything".
 */
const UNSAFE = new Set(['do', 'run', 'runpy', 'extend', 'new_command', 'alias', 'quit', 'system']);

/**
 * Flags PyMOL documents as 0/1 rather than booleans. Emitting them as
 * `boolean` alone would be a lie: callers pass 1 and 0 everywhere in PyMOL's
 * own docs and scripts, and the C side accepts both.
 */
const ZERO_ONE = new Set(['quiet', 'updates', 'animate', 'hand', 'ray', 'partial', 'discrete']);

/** Return types worth stating precisely; everything else stays `unknown`. */
const RETURNS = {
  get_view: 'View18',
  get_names: 'string[]',
  get_object_list: 'string[]',
  get_chains: 'string[]',
  get_setting_tuple: '[number, unknown[]]',
  count_atoms: 'number',
  count_states: 'number',
  count_frames: 'number',
  get_frame: 'number',
  get_state: 'number',
  get_progress: 'number',
  get_extent: '[Vec3, Vec3]',
  get_color_tuple: 'RGB',
  get_title: 'string',
  get_type: 'string',
  get_legal_name: 'string',
  get_unused_name: 'string',
  get_version: 'unknown[]',
};

const IDENT = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

function typeFromDefault(name, def) {
  if (def === null) return null;
  if (ZERO_ONE.has(name)) return 'Bool01';
  if (def === 'True' || def === 'False') return 'boolean';
  if (/^-?\d+$/.test(def)) return 'number';
  if (/^-?\d*\.\d+$/.test(def)) return 'number';
  if (/^['"]/.test(def)) return 'string';
  if (def === 'None') return null;
  return null;
}

function typeFromDocArgument(entry) {
  if (!entry) return null;
  const kind = entry.type.toLowerCase();
  if (kind.includes('int') || kind.includes('float')) return 'number';
  if (kind.includes('str')) return 'string';
  if (kind.includes('bool') || kind === '0/1') return 'Bool01';
  if (kind.includes('list')) return 'unknown[]';
  return null;
}

function typeFor(param, docArguments, autoArgTypes, commandName) {
  if (param.annotation === 'int' || param.annotation === 'float') return 'number';
  if (param.annotation === 'str') return 'string';
  if (param.annotation === 'bool') return 'boolean';

  // `auto_arg` position 0/1/2 corresponds to the 1st/2nd/3rd argument.
  const position = autoArgTypes[param.index];
  const domain = position ? position[commandName] : undefined;
  if (domain === 'selection') return 'Selection';
  if (domain === 'object') return 'ObjectName';

  return (
    typeFromDefault(param.name, param.default) ??
    typeFromDocArgument(docArguments[param.name]) ??
    'ApiValue'
  );
}

function jsdoc(command, sections) {
  const lines = [];
  const description = (sections.DESCRIPTION ?? '').trim();
  if (description) {
    for (const line of description.split('\n').slice(0, 6)) lines.push(` * ${line.trim()}`);
  }
  const see = (sections['SEE ALSO'] ?? '').trim();
  if (see) lines.push(` * @see ${see.split('\n').map((s) => s.trim()).filter(Boolean).join(', ')}`);
  if (lines.length === 0) return '';
  return `/**\n${lines.join('\n')}\n */\n`;
}

function emitCommand(name, spec, autoArgTypes) {
  const params = spec.params.map((p, index) => ({ ...p, index }));
  const positional = [];
  const optional = [];

  let seenDefault = false;
  for (const param of params) {
    if (param.kind === 'VAR_POSITIONAL' || param.kind === 'VAR_KEYWORD') continue;
    // KEYWORD_ONLY always goes in the options bag; so does everything from the
    // first defaulted parameter onward, because a caller cannot skip a middle
    // positional in TypeScript any more than in Python.
    if (param.kind === 'KEYWORD_ONLY' || param.hasDefault) seenDefault = true;
    (seenDefault ? optional : positional).push(param);
  }

  const argType = (p) => typeFor(p, spec.docArguments, autoArgTypes, name);
  const head = positional
    .filter((p) => IDENT.test(p.name))
    .map((p) => `${p.name}: ${argType(p)}`);

  const bag = optional
    .filter((p) => IDENT.test(p.name))
    .map((p) => `    ${p.name}?: ${argType(p)};`);

  const signature = [...head];
  if (bag.length > 0) signature.push(`options?: {\n${bag.join('\n')}\n  }`);

  const returns = RETURNS[name] ?? 'unknown';
  return `${jsdoc(name, spec.sections)}  ${name}(${signature.join(', ')}): Promise<${returns}>;`;
}

function main() {
  const [, , schemaPath, outPath] = process.argv;
  if (!schemaPath || !outPath) {
    console.error('usage: emit.mjs <schema.json> <out.ts>');
    return 1;
  }
  const schema = JSON.parse(readFileSync(schemaPath, 'utf8'));
  const autoArgTypes = schema.domains.autoArgTypes ?? [];

  const names = Object.keys(schema.commands).sort();
  const safe = names.filter((n) => !UNSAFE.has(n));
  const unsafe = names.filter((n) => UNSAFE.has(n));

  const body = [
    '/* GENERATED by tools/gen-api/emit.mjs — do not edit.',
    ' *',
    ' * Regenerate:',
    ' *   packages/bridge/.venv/bin/python tools/gen-api/extract.py > tools/gen-api/api-schema.json',
    ' *   node tools/gen-api/emit.mjs tools/gen-api/api-schema.json \\',
    ' *     packages/protocol/src/generated/api.ts',
    ' *',
    ' * The signatures come from a LIVE PyMOL via `inspect.signature`, not from',
    ' * parsing `api.py` — which is a re-export manifest with no function bodies.',
    ' */',
    '',
    '/** A value the wire can carry when nothing more precise is known. */',
    'export type ApiValue = string | number | boolean | null | ApiValue[];',
    '',
    '/** PyMOL documents these as 0/1 and accepts booleans too. */',
    'export type Bool01 = boolean | 0 | 1;',
    '',
    '/** An atom-selection expression. Branded so it is not just `string`. */',
    'export type Selection = string;',
    'export type ObjectName = string;',
    'export type Vec3 = [number, number, number];',
    'export type RGB = [number, number, number];',
    '/** `cmd.get_view()` — 18 floats. */',
    'export type View18 = number[];',
    '',
    `/** ${safe.length} introspectable commands. */`,
    'export interface PymolApi {',
    safe.map((n) => emitCommand(n, schema.commands[n], autoArgTypes)).join('\n\n'),
    '}',
    '',
    '/**',
    ' * Commands that execute arbitrary text or end the session.',
    ' *',
    ' * Separated deliberately: a typed wrapper around `do` is a typed wrapper',
    ' * around "run anything", and it should not sit in the same autocomplete list',
    ' * as `color`.',
    ' */',
    'export interface PymolUnsafeApi {',
    unsafe.map((n) => emitCommand(n, schema.commands[n], autoArgTypes)).join('\n\n'),
    '}',
    '',
    '/** Every setting name PyMOL knows, for `set`/`get` autocompletion. */',
    `export const SETTING_NAMES = ${JSON.stringify(schema.domains.settings)} as const;`,
    'export type SettingName = (typeof SETTING_NAMES)[number];',
    '',
    '/** Every named colour. */',
    `export const COLOR_NAMES = ${JSON.stringify(schema.domains.colors)} as const;`,
    'export type ColorName = (typeof COLOR_NAMES)[number];',
    '',
  ].join('\n');

  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, body, 'utf8');
  console.error(
    `emit: ${safe.length} commands, ${unsafe.length} unsafe, ` +
      `${schema.domains.settings.length} settings, ${schema.domains.colors.length} colours`,
  );
  return 0;
}

process.exit(main());
