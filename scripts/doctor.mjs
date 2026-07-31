#!/usr/bin/env node
/**
 * tenmol doctor (WP-00) -- preflight for the web-client dev loop.
 *
 * Checks, in order, the things that have actually broken in this repo:
 *   node / pnpm / workspace install
 *   the venv, `import pymol`, `import tenmol_bridge`
 *   offscreen GL context creation (the exact CGL+FBO recipe from
 *     docs/webclient/spikes/04-picking.md section 2 -- not re-derived)
 *   the dev ports
 *
 * Exit codes: 0 all required checks pass, 1 a required check failed.
 * `--json` prints machine-readable results, `--quiet` prints only failures.
 *
 * Usage: pnpm run doctor [--json] [--quiet]
 *        (`pnpm doctor` without `run` hits pnpm's own builtin doctor command)
 */
import { execFileSync } from 'node:child_process';
import { accessSync, constants, existsSync } from 'node:fs';
import { createServer } from 'node:net';
import { delimiter, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = dirname(dirname(fileURLToPath(import.meta.url)));
const argv = process.argv.slice(2);
const JSON_OUT = argv.includes('--json');
const QUIET = argv.includes('--quiet');

/** @type {{name:string,status:'ok'|'warn'|'fail',detail:string,fix?:string}[]} */
const results = [];
const add = (name, status, detail, fix) => {
  results.push({ name, status, detail, ...(fix ? { fix } : {}) });
  return status;
};

const sh = (cmd, args, opts = {}) =>
  execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...opts }).trim();

/** PATH lookup without a shell (no exec of an interpolated string). */
const which = (bin) => {
  for (const dir of (process.env.PATH ?? '').split(delimiter)) {
    if (!dir) continue;
    const candidate = join(dir, bin);
    try {
      accessSync(candidate, constants.X_OK);
      return candidate;
    } catch {
      /* next */
    }
  }
  return '';
};

// --------------------------------------------------------------------------
// node / pnpm / workspace
// --------------------------------------------------------------------------
{
  const major = Number(process.versions.node.split('.')[0]);
  if (major >= 22) add('node', 'ok', `v${process.versions.node}`);
  else add('node', 'fail', `v${process.versions.node} (need >= 22)`, 'brew install node');
}

{
  const bin = which('pnpm');
  if (!bin) {
    add('pnpm', 'fail', 'not found', 'corepack enable && corepack prepare pnpm@9.15.4 --activate');
  } else {
    let version = '?';
    try {
      version = sh('pnpm', ['--version']);
    } catch {
      /* reported below */
    }
    const major = Number(version.split('.')[0]);
    if (major >= 9) add('pnpm', 'ok', `${version} (${bin})`);
    else add('pnpm', 'fail', `${version} (need >= 9)`, 'corepack prepare pnpm@9.15.4 --activate');
  }
}

add(
  'workspace install',
  existsSync(join(REPO, 'node_modules', '.pnpm')) ? 'ok' : 'fail',
  existsSync(join(REPO, 'node_modules', '.pnpm')) ? 'node_modules present' : 'no node_modules',
  'pnpm install',
);

// --------------------------------------------------------------------------
// python venv
// --------------------------------------------------------------------------
const venvCandidates = [
  process.env.TENMOL_VENV && join(process.env.TENMOL_VENV, 'bin', 'python'),
  join(REPO, 'bridge', '.venv', 'bin', 'python'),
  join(REPO, '.venv', 'bin', 'python'),
].filter(Boolean);
const PY = venvCandidates.find((p) => existsSync(p)) ?? '';

if (PY) {
  let v = '?';
  try {
    v = sh(PY, ['-c', 'import sys;print("%d.%d.%d"%sys.version_info[:3])']);
  } catch {
    /* keep '?' */
  }
  add('python venv', 'ok', `${v} at ${PY.replace(REPO + '/', '')}`);
} else {
  add('python venv', 'fail', `none of: ${venvCandidates.join(', ')}`, 'bash scripts/bootstrap.sh');
}

const pyCheck = (name, code, fix, required = true) => {
  if (!PY) return add(name, required ? 'fail' : 'warn', 'no venv');
  try {
    const out = execFileSync(PY, ['-c', code], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 120_000,
    }).trim();
    return add(name, 'ok', out.split('\n').pop() ?? 'ok');
  } catch (err) {
    const e = /** @type {{stderr?:string,stdout?:string,message?:string}} */ (err);
    const msg = (e.stderr || e.stdout || e.message || '').trim().split('\n').pop() ?? 'failed';
    return add(name, required ? 'fail' : 'warn', msg, fix);
  }
};

pyCheck(
  'import pymol',
  'import pymol;print(pymol.get_version_message(),"->",pymol.__file__)',
  'bash scripts/bootstrap.sh --force-pymol',
);

// MMTF/BCIF are parity rows. A `use-msgpackc=no` build still imports fine and
// still saves a 0-byte .mmtf much later, so probe the round-trip explicitly
// (spikes/00-build.md section 5.2 does exactly this: 877 bytes, 10 atoms back).
pyCheck(
  'pymol MMTF/BCIF',
  [
    'import os, tempfile, pymol2',
    'with pymol2.PyMOL() as p:',
    '    c = p.cmd',
    '    c.fragment("ala")',
    '    d = tempfile.mkdtemp()',
    '    f = os.path.join(d, "probe.mmtf")',
    '    c.save(f)',
    '    n = os.path.getsize(f)',
    '    c.delete("all"); c.load(f)',
    '    print("mmtf round-trip: %d bytes, %d atoms" % (n, c.count_atoms("all")))',
  ].join('\n'),
  'rebuild with: bash scripts/bootstrap.sh --force-pymol  (NEVER use-msgpackc=no)',
);

pyCheck(
  'import tenmol_bridge',
  'import tenmol_bridge as b;print("tenmol_bridge",b.__version__)',
  'bash scripts/bootstrap.sh',
);

// --------------------------------------------------------------------------
// offscreen GL -- verbatim from docs/webclient/spikes/04-picking.md section 2
// --------------------------------------------------------------------------
const GL_PROBE = String.raw`
import sys, ctypes, platform
W = H = 64
if platform.system() != "Darwin":
    print("no offscreen GL implementation for %s yet (WP-02)" % platform.system())
    sys.exit(3)
GLF = ctypes.CDLL("/System/Library/Frameworks/OpenGL.framework/OpenGL")
gl = ctypes.CDLL("/System/Library/Frameworks/OpenGL.framework/Libraries/libGL.dylib")
# kCGLPFAOpenGLProfile=99, kCGLOGLPVersion_Legacy=0x1000, ColorSize=8, DepthSize=12
attrs = (ctypes.c_int * 7)(99, 0x1000, 8, 24, 12, 24, 0)
pix = ctypes.c_void_p(); n = ctypes.c_int()
if GLF.CGLChoosePixelFormat(attrs, ctypes.byref(pix), ctypes.byref(n)) != 0:
    raise SystemExit("CGLChoosePixelFormat failed")
ctx = ctypes.c_void_p()
if GLF.CGLCreateContext(pix, None, ctypes.byref(ctx)) != 0:
    raise SystemExit("CGLCreateContext failed (no window server session?)")
if GLF.CGLSetCurrentContext(ctx) != 0:
    raise SystemExit("CGLSetCurrentContext failed")
gl.glGetString.restype = ctypes.c_char_p
ver = gl.glGetString(0x1F02); ren = gl.glGetString(0x1F01)
fbo = ctypes.c_uint(); gl.glGenFramebuffersEXT(1, ctypes.byref(fbo))
gl.glBindFramebufferEXT(0x8D40, fbo)
for att, fmt in ((0x8CE0, 0x8058), (0x8D00, 0x81A6)):
    rb = ctypes.c_uint(); gl.glGenRenderbuffersEXT(1, ctypes.byref(rb))
    gl.glBindRenderbufferEXT(0x8D41, rb)
    gl.glRenderbufferStorageEXT(0x8D41, fmt, W, H)
    gl.glFramebufferRenderbufferEXT(0x8D40, att, 0x8D41, rb)
status = gl.glCheckFramebufferStatusEXT(0x8D40)
if status != 0x8CD5:
    raise SystemExit("FBO incomplete: 0x%X" % status)
print("%s / %s / FBO complete" % (ver.decode(), ren.decode()))
`;

if (!PY) {
  add('offscreen GL', 'fail', 'no venv', 'bash scripts/bootstrap.sh');
} else {
  try {
    const out = execFileSync(PY, ['-c', GL_PROBE], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 60_000,
    }).trim();
    add('offscreen GL', 'ok', out);
  } catch (err) {
    const e = /** @type {{status?:number,stderr?:string,stdout?:string,message?:string}} */ (err);
    const msg =
      (e.stdout || e.stderr || e.message || '').trim().split('\n').pop() ??
      'context creation failed';
    // exit 3 == platform not implemented yet: a warning, not a failure.
    add(
      'offscreen GL',
      e.status === 3 ? 'warn' : 'fail',
      msg,
      'macOS: run from a logged-in GUI session (ssh/CI without a window server ' +
        'cannot create a hardware CGL context)',
    );
  }
}

// --------------------------------------------------------------------------
// ports
// --------------------------------------------------------------------------
const portFree = (port) =>
  new Promise((resolve) => {
    const s = createServer();
    s.once('error', () => resolve(false));
    s.once('listening', () => s.close(() => resolve(true)));
    s.listen(port, '127.0.0.1');
  });

for (const [port, who] of [
  [8765, 'bridge'],
  [5173, 'vite'],
]) {
  const free = await portFree(port);
  add(
    `port ${port} (${who})`,
    free ? 'ok' : 'warn',
    free ? 'free' : 'in use (a previous dev server? vite will probe for the next free port)',
  );
}

// --------------------------------------------------------------------------
// repo hygiene
// --------------------------------------------------------------------------
try {
  const dirty = sh('git', ['status', '--porcelain', '--', 'modules', 'testing', 'layer0'], {
    cwd: REPO,
  });
  add(
    'upstream tree clean',
    dirty ? 'warn' : 'ok',
    dirty ? `${dirty.split('\n').length} untracked/modified upstream path(s)` : 'clean',
    'bash scripts/bootstrap.sh re-appends .git/info/exclude entries',
  );
} catch {
  add('upstream tree clean', 'warn', 'not a git checkout');
}

// --------------------------------------------------------------------------
// report
// --------------------------------------------------------------------------
const failed = results.filter((r) => r.status === 'fail');

if (JSON_OUT) {
  console.log(JSON.stringify({ ok: failed.length === 0, results }, null, 2));
} else {
  const pad = Math.max(...results.map((r) => r.name.length));
  const glyph = { ok: '✓', warn: '!', fail: '✗' };
  const colour = { ok: '\x1b[32m', warn: '\x1b[33m', fail: '\x1b[31m' };
  const reset = '\x1b[0m';
  if (!QUIET) console.log('\ntenmol doctor\n');
  for (const r of results) {
    if (QUIET && r.status === 'ok') continue;
    console.log(
      `  ${colour[r.status]}${glyph[r.status]}${reset} ${r.name.padEnd(pad)}  ${r.detail}`,
    );
    if (r.fix && r.status !== 'ok') console.log(`    ${' '.repeat(pad)}  -> ${r.fix}`);
  }
  console.log(
    failed.length === 0
      ? '\n  all required checks passed\n'
      : `\n  ${failed.length} required check(s) failed\n`,
  );
}

process.exit(failed.length === 0 ? 0 : 1);
