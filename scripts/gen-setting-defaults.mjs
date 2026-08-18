#!/usr/bin/env node
// Parse packages/engine/layer1/SettingInfo.h and emit the comprehensive
// setting-defaults.ts data table for engine-ts. See settings2.ts.
import { readFileSync, writeFileSync } from 'node:fs';

const SRC = 'packages/engine/layer1/SettingInfo.h';
const OUT = 'packages/engine-ts/src/cmd/setting-defaults.ts';

// Symbolic constants that appear as defaults in the table.
const CONSTS = {
  cOrthoRightSceneMargin: 220, // Ortho.h: DIP2PIXEL(220)
  cPuttyTransformNormalizedNonlinear: 0, // Base.h
  MAX_SPHERE_QUALITY: 4,
};

const text = readFileSync(SRC, 'utf8');
const lines = text.split('\n');

// Strip a trailing // or /* */ comment from an argument blob.
function stripComment(s) {
  // remove /* ... */ (single line) and // ...
  s = s.replace(/\/\*.*?\*\//g, '');
  s = s.replace(/\/\/.*$/, '');
  return s;
}

function numLit(tok) {
  tok = tok.trim();
  if (tok === 'true') return 1;
  if (tok === 'false') return 0;
  if (Object.prototype.hasOwnProperty.call(CONSTS, tok)) return CONSTS[tok];
  // strip trailing F/f float suffix; handle forms like 0.000F, -1.F, 25.f, 0x1FF
  if (/^0x[0-9a-fA-F]+$/.test(tok)) return parseInt(tok, 16);
  const m = tok.replace(/[Ff]$/, '');
  const n = Number(m);
  if (Number.isNaN(n)) throw new Error(`cannot parse numeric literal: ${JSON.stringify(tok)}`);
  return n;
}

// Split top-level comma-separated args (values here never contain nested parens
// or commas beyond simple tokens, so a simple split works after comment strip).
function splitArgs(blob) {
  return blob.split(',').map((s) => s.trim()).filter((s) => s.length > 0);
}

const entries = []; // {name, type, def}
const re = /^\s*REC_([_bif3sc])\(\s*(\d+)\s*,\s*([a-zA-Z0-9_]+)\s*,\s*([a-zA-Z]+)\s*,?(.*)\)\s*,?\s*$/;
// blank slots: REC__( 83, ),
const reBlank = /^\s*REC__\(\s*(\d+)\s*,?\s*\)\s*,?\s*$/;

for (let raw of lines) {
  raw = stripComment(raw);
  if (reBlank.test(raw)) continue;
  const m = re.exec(raw);
  if (!m) continue;
  const t = m[1];
  const name = m[3];
  let rest = stripComment(m[5]).trim();
  // rest may end with a stray ) captured? No, regex consumes trailing ). But
  // some lines have inner content only. rest is the value blob.
  let def;
  if (t === '_') {
    continue; // blank
  } else if (t === 'b') {
    def = numLit(rest);
  } else if (t === 'i') {
    // first arg is the value (may be followed by min,max)
    def = numLit(splitArgs(rest)[0]);
  } else if (t === 'f') {
    def = numLit(splitArgs(rest)[0]);
  } else if (t === '3') {
    // float3 (vector): the compiled-in default is a [x,y,z] triple. Scalar
    // get_setting_float on a float3 returns 0 (verified vs the oracle), but the
    // tuple/text readers need the real vector, so we emit all three components.
    const comps = splitArgs(rest).map(numLit);
    if (comps.length !== 3) throw new Error(`bad float3 default for ${name}: ${rest}`);
    def = comps;
  } else if (t === 's') {
    // string literal in quotes
    const sm = rest.match(/^"((?:[^"\\]|\\.)*)"$/);
    if (!sm) throw new Error(`bad string default for ${name}: ${rest}`);
    def = sm[1];
  } else if (t === 'c') {
    // color: quoted default (index string or color name)
    const cm = rest.match(/^"((?:[^"\\]|\\.)*)"$/);
    if (!cm) throw new Error(`bad color default for ${name}: ${rest}`);
    def = { color: cm[1] };
  }
  entries.push({ name, type: t, def });
}

// Emit
let out = `/**
 * Comprehensive compiled-in setting defaults, generated from PyMOL's
 * \`packages/engine/layer1/SettingInfo.h\` (the \`REC_*\` macro table). One entry
 * per non-blank setting, holding the upstream default value:
 *
 *   - boolean (\`REC_b\`)  -> 0 | 1
 *   - int     (\`REC_i\`)  -> the default int (min/max args dropped)
 *   - float   (\`REC_f\`)  -> the default float
 *   - float3  (\`REC_3\`)  -> the [x,y,z] vector (get_setting_tuple/text read the
 *                            triple; get_setting_float on a float3 returns 0)
 *   - string  (\`REC_s\`)  -> the default string, verbatim
 *   - color   (\`REC_c\`)  -> the raw default color reference string ("-1", "red",
 *                            "0x000000", …); \`resolveSetting\` runs it through
 *                            \`getColorIndex\` so reads return the color INDEX.
 *
 * Consulted by \`resolveSetting\` (\`cmd/settings2.ts\`) as the final fallback when
 * a setting has no per-object override and no value in the executive's live
 * store, so \`get_setting_int/float/boolean/text(name)\` returns PyMOL's real
 * default for EVERY setting instead of a bare 0.
 *
 * DO NOT EDIT BY HAND — regenerate with \`node scripts/gen-setting-defaults.mjs\`.
 */

/* eslint-disable */

/** Colour-typed setting default: a raw colour reference resolved at read time. */
export interface ColorDefault {
  readonly color: string;
}

export const SETTING_INFO_DEFAULTS: Readonly<Record<string, number | string | number[] | ColorDefault>> = {
`;

for (const e of entries) {
  const key = JSON.stringify(e.name);
  let val;
  if (e.type === 'c') val = `{ color: ${JSON.stringify(e.def.color)} }`;
  else if (e.type === 's') val = JSON.stringify(e.def);
  else if (e.type === '3') val = `[${e.def.join(', ')}]`;
  else val = String(e.def);
  out += `  ${key}: ${val},\n`;
}
out += `};\n`;

writeFileSync(OUT, out);
console.log(`wrote ${entries.length} setting defaults to ${OUT}`);
// quick sanity on the 5 targets
for (const n of ['active_selections', 'ambient_occlusion_scale', 'ambient_occlusion_smooth', 'anaglyph_mode', 'angle_label_position']) {
  const e = entries.find((x) => x.name === n);
  console.log(`  ${n} =`, e ? JSON.stringify(e.def) : 'MISSING');
}
