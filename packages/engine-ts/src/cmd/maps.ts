/**
 * The `maps` command subsystem — scalar volume maps, isosurfaces and volumes.
 *
 * Ports the shape of PyMOL's `ObjectMap` / `ObjectSurface` / `ObjectMesh`
 * (`layer2/ObjectMap.cpp`, `map_new` / `isomesh` / `isosurface` / `volume`):
 *
 *   map_new       — build a 3-D scalar grid over a selection's bounding box.
 *                   A "gaussian" map sums a per-atom gaussian kernel; a "vdw"
 *                   map is a van-der-Waals indicator (1 inside any atom sphere).
 *   get_volume_field / get_volume_histogram — introspect a stored grid.
 *   isolevel      — record a contour level on a map.
 *   map_trim / map_double / map_halve / map_set_border — resample / crop a grid.
 *   isomesh / isosurface / isodot — run marching cubes at a level and store the
 *                   resulting triangle mesh (or dot cloud) under a NEW object.
 *   get_isosurface_stats — {verts, tris} of a generated surface (for testing).
 *
 * A compact 256-case marching-cubes implementation (standard triangle table)
 * lives at the bottom of this file; only the triangle table is needed because
 * the per-cube intersected edges are read straight from it.
 */
import type { Json } from '@tenmol/protocol';
import type { RegistrarCtx } from './registrar';

/* --------------------------------- types --------------------------------- */

type Vec3 = [number, number, number];

/** A stored scalar volume: a regular grid `dims[x]*dims[y]*dims[z]` of floats. */
interface VolMap {
  name: string;
  origin: Vec3;
  spacing: Vec3;
  dims: Vec3;
  /** Row-major: index = x + dims[0]*(y + dims[1]*z). */
  data: Float32Array;
  /** Recorded contour levels (`isolevel`). */
  levels: number[];
}

/** A generated isosurface/isomesh/isodot object. */
interface IsoObject {
  name: string;
  /** Flat vertex coordinates (xyz triplets). */
  verts: Float32Array;
  /** Triangle indices (empty for isodot). */
  indices: Uint32Array;
  kind: 'mesh' | 'surface' | 'dot';
  /** Current contour level (settable/queryable via `isolevel`). */
  level: number;
}

/* -------------------------------- helpers -------------------------------- */

function toNum(v: unknown, dflt: number): number {
  if (v == null || v === '') return dflt;
  const n = Number(v);
  return Number.isFinite(n) ? n : dflt;
}
function toStr(v: unknown, dflt = ''): string {
  return v == null ? dflt : String(v);
}

/** Linear cell index into a grid's data array. */
function idx(dims: Vec3, x: number, y: number, z: number): number {
  return x + dims[0] * (y + dims[1] * z);
}

/* ------------------------------ registration ----------------------------- */

export function registerMaps(ctx: RegistrarCtx): void {
  const ex = ctx.executive;
  // Per-registration state (closure-scoped, so isolated tests never leak).
  const maps = new Map<string, VolMap>();
  const isoObjects = new Map<string, IsoObject>();

  /* ------------------------------- map_new ------------------------------- */

  ctx.command('map_new', (args, kwargs): Json => {
    const name = toStr(args[0] ?? kwargs.name);
    const type = toStr(args[1] ?? kwargs.type, 'gaussian').toLowerCase();
    const grid = toNum(args[2] ?? kwargs.grid, 0.5);
    const selection = toStr(args[3] ?? kwargs.selection, '(all)') || '(all)';
    const buffer = toNum(args[4] ?? kwargs.buffer, 0);
    const stateArg = toNum(args[5] ?? kwargs.state, 0);
    const state = stateArg <= 0 ? 1 : stateArg;

    const atoms = ex.atomsMatching(selection);
    if (atoms.length === 0) {
      throw new Error(`map_new: selection '${selection}' matched no atoms`);
    }

    // Bounding box over the selected atoms, padded by their vdw radius so a
    // gaussian/vdw kernel is not clipped, plus the caller's buffer.
    const min: Vec3 = [Infinity, Infinity, Infinity];
    const max: Vec3 = [-Infinity, -Infinity, -Infinity];
    const pts: Array<{ p: Vec3; vdw: number }> = [];
    for (const ua of atoms) {
      const mol = ex.molecule(ua.objName);
      if (!mol) continue;
      const p = mol.coord(ua.index, state) as Vec3;
      const r = mol.vdw(ua.index);
      pts.push({ p, vdw: r });
      for (let k = 0; k < 3; k++) {
        const lo = p[k]! - r;
        const hi = p[k]! + r;
        if (lo < min[k]!) min[k] = lo;
        if (hi > max[k]!) max[k] = hi;
      }
    }
    for (let k = 0; k < 3; k++) {
      min[k]! -= buffer;
      max[k]! += buffer;
    }

    const g = grid > 0 ? grid : 0.5;
    const spacing: Vec3 = [g, g, g];
    const origin: Vec3 = [min[0], min[1], min[2]];
    const dims: Vec3 = [
      Math.max(2, Math.floor((max[0] - min[0]) / g) + 1),
      Math.max(2, Math.floor((max[1] - min[1]) / g) + 1),
      Math.max(2, Math.floor((max[2] - min[2]) / g) + 1),
    ];

    const data = new Float32Array(dims[0] * dims[1] * dims[2]);
    for (let z = 0; z < dims[2]; z++) {
      const wz = origin[2] + z * spacing[2];
      for (let y = 0; y < dims[1]; y++) {
        const wy = origin[1] + y * spacing[1];
        for (let x = 0; x < dims[0]; x++) {
          const wx = origin[0] + x * spacing[0];
          let v = 0;
          for (const { p, vdw } of pts) {
            const dx = wx - p[0];
            const dy = wy - p[1];
            const dz = wz - p[2];
            const d2 = dx * dx + dy * dy + dz * dz;
            if (type === 'vdw') {
              // Indicator: 1 inside any atom's vdw sphere.
              if (d2 <= vdw * vdw) {
                v = 1;
                break;
              }
            } else {
              // Gaussian kernel; sigma tied to the atom's vdw radius so the
              // peak sits on the atom and falls off over ~one radius.
              const sigma = vdw * 0.5;
              v += Math.exp(-d2 / (2 * sigma * sigma));
            }
          }
          data[idx(dims, x, y, z)] = v;
        }
      }
    }

    maps.set(name, { name, origin, spacing, dims, data, levels: [] });
    ex.registerGadget(name, 'object:map');
    ctx.publish();
    return name;
  });

  /* --------------------------- get_volume_field -------------------------- */

  ctx.command('get_volume_field', (args, kwargs): Json => {
    const name = toStr(args[0] ?? kwargs.name);
    const m = maps.get(name);
    if (!m) throw new Error(`get_volume_field: no map named '${name}'`);
    return { dims: [...m.dims], data: Array.from(m.data) };
  });

  /* ------------------------- get_volume_histogram ------------------------ */

  ctx.command('get_volume_histogram', (args, kwargs): Json => {
    // PyMOL (querying.py:62) returns a flat list of length `bins + 4`:
    //   [min, max, mean, stdev, h0 .. h(bins-1)]
    // `range` defaults to (0., 0.) which means "use the full data range".
    const name = toStr(args[0] ?? kwargs.name);
    const bins = Math.max(1, Math.floor(toNum(args[1] ?? kwargs.bins, 64)));
    const m = maps.get(name);
    if (!m) throw new Error(`get_volume_histogram: no map named '${name}'`);

    // Data min/max, mean and (population) standard deviation.
    let dmin = Infinity;
    let dmax = -Infinity;
    let sum = 0;
    let sumSq = 0;
    const n = m.data.length;
    for (const v of m.data) {
      if (v < dmin) dmin = v;
      if (v > dmax) dmax = v;
      sum += v;
      sumSq += v * v;
    }
    if (!Number.isFinite(dmin)) {
      dmin = 0;
      dmax = 0;
    }
    const mean = n > 0 ? sum / n : 0;
    const variance = n > 0 ? Math.max(0, sumSq / n - mean * mean) : 0;
    const stdev = Math.sqrt(variance);

    // Histogram range: explicit `range` arg (unless it is the (0,0) sentinel),
    // otherwise the full data range.
    const rng = (args[2] ?? kwargs.range) as unknown;
    let lo = dmin;
    let hi = dmax;
    if (Array.isArray(rng) && rng.length >= 2) {
      const r0 = Number(rng[0]);
      const r1 = Number(rng[1]);
      if (Number.isFinite(r0) && Number.isFinite(r1) && !(r0 === 0 && r1 === 0)) {
        lo = r0;
        hi = r1;
      }
    }

    const counts = new Array<number>(bins).fill(0);
    const span = hi - lo;
    for (const v of m.data) {
      let b = span > 0 ? Math.floor(((v - lo) / span) * bins) : 0;
      if (b < 0) b = 0;
      if (b >= bins) b = bins - 1;
      counts[b] = (counts[b] ?? 0) + 1;
    }
    return [dmin, dmax, mean, stdev, ...counts];
  });

  /* ------------------------------- isolevel ------------------------------ */

  ctx.command('isolevel', (args, kwargs): Json => {
    const name = toStr(args[0] ?? kwargs.name);
    const query = toNum(args[3] ?? kwargs.query, 0);
    // `isolevel` operates on the isodot/isomesh/isosurface object (matching
    // real PyMOL, where the level lives on ObjectMesh/ObjectSurface). When
    // `query` is truthy it reads the current level back; otherwise it sets it.
    const iso = isoObjects.get(name);
    if (iso) {
      if (query) return iso.level;
      const level = toNum(args[1] ?? kwargs.level, 1);
      iso.level = level;
      ctx.publish();
      return level;
    }
    // Fall back to naming a map directly (records a level on the grid).
    const m = maps.get(name);
    if (m) {
      if (query) return m.levels.length > 0 ? m.levels[m.levels.length - 1]! : 1;
      const level = toNum(args[1] ?? kwargs.level, 1);
      m.levels.push(level);
      ctx.publish();
      return level;
    }
    throw new Error(`isolevel: no map named '${name}'`);
  });

  /* --------------------------- map_trim / resample ----------------------- */

  ctx.command('map_trim', (args, kwargs): Json => {
    const name = toStr(args[0] ?? kwargs.name);
    const selection = toStr(args[1] ?? kwargs.selection, '(all)') || '(all)';
    const buffer = toNum(args[2] ?? kwargs.buffer, 0);
    const m = maps.get(name);
    if (!m) throw new Error(`map_trim: no map named '${name}'`);

    const atoms = ex.atomsMatching(selection);
    const min: Vec3 = [Infinity, Infinity, Infinity];
    const max: Vec3 = [-Infinity, -Infinity, -Infinity];
    for (const ua of atoms) {
      const mol = ex.molecule(ua.objName);
      if (!mol) continue;
      const p = mol.coord(ua.index, 1) as Vec3;
      for (let k = 0; k < 3; k++) {
        if (p[k]! - buffer < min[k]!) min[k] = p[k]! - buffer;
        if (p[k]! + buffer > max[k]!) max[k] = p[k]! + buffer;
      }
    }
    if (!Number.isFinite(min[0])) return name; // nothing to trim to

    // Grid index window that covers [min,max], clamped to the existing grid.
    const lo: Vec3 = [0, 0, 0];
    const hi: Vec3 = [0, 0, 0];
    for (let k = 0; k < 3; k++) {
      let a = Math.floor((min[k]! - m.origin[k]!) / m.spacing[k]!);
      let b = Math.ceil((max[k]! - m.origin[k]!) / m.spacing[k]!);
      if (a < 0) a = 0;
      if (b > m.dims[k]! - 1) b = m.dims[k]! - 1;
      if (b < a) b = a;
      lo[k] = a;
      hi[k] = b;
    }
    const newDims: Vec3 = [hi[0] - lo[0] + 1, hi[1] - lo[1] + 1, hi[2] - lo[2] + 1];
    const newOrigin: Vec3 = [
      m.origin[0] + lo[0] * m.spacing[0],
      m.origin[1] + lo[1] * m.spacing[1],
      m.origin[2] + lo[2] * m.spacing[2],
    ];
    const nd = new Float32Array(newDims[0] * newDims[1] * newDims[2]);
    for (let z = 0; z < newDims[2]; z++)
      for (let y = 0; y < newDims[1]; y++)
        for (let x = 0; x < newDims[0]; x++)
          nd[idx(newDims, x, y, z)] =
            m.data[idx(m.dims, x + lo[0], y + lo[1], z + lo[2])] ?? 0;
    m.origin = newOrigin;
    m.dims = newDims;
    m.data = nd;
    ctx.publish();
    return name;
  });

  ctx.command('map_double', (args, kwargs): Json => {
    const name = toStr(args[0] ?? kwargs.name);
    const m = maps.get(name);
    if (!m) throw new Error(`map_double: no map named '${name}'`);
    resampleUniform(m, +1);
    ctx.publish();
    return name;
  });

  ctx.command('map_halve', (args, kwargs): Json => {
    const name = toStr(args[0] ?? kwargs.name);
    const m = maps.get(name);
    if (!m) throw new Error(`map_halve: no map named '${name}'`);
    resampleUniform(m, -1);
    ctx.publish();
    return name;
  });

  ctx.command('map_set_border', (args, kwargs): Json => {
    const name = toStr(args[0] ?? kwargs.name);
    const level = toNum(args[1] ?? kwargs.level, 0);
    const m = maps.get(name);
    if (!m) throw new Error(`map_set_border: no map named '${name}'`);
    const [dx, dy, dz] = m.dims;
    for (let z = 0; z < dz; z++)
      for (let y = 0; y < dy; y++)
        for (let x = 0; x < dx; x++) {
          if (x === 0 || y === 0 || z === 0 || x === dx - 1 || y === dy - 1 || z === dz - 1)
            m.data[idx(m.dims, x, y, z)] = level;
        }
    ctx.publish();
    return name;
  });

  /* ------------------------------- map_set ------------------------------- */

  // Operator names -> internal index (ObjectMap map arithmetic), matching
  // PyMOL's `map_op_dict` in editing.py.
  const MAP_OPS = [
    'minimum',
    'maximum',
    'sum',
    'average',
    'difference',
    'copy',
    'unique',
  ] as const;

  /** Resolve an operator string via unique-prefix shortcut (PyMOL Shortcut). */
  const resolveOp = (raw: string): string => {
    const s = raw.toLowerCase();
    if ((MAP_OPS as readonly string[]).includes(s)) return s;
    const hits = MAP_OPS.filter((o) => o.startsWith(s));
    if (hits.length === 1) return hits[0]!;
    throw new Error(`map_set: Invalid operator '${raw}'.`);
  };

  ctx.command('map_set', (args, kwargs): Json => {
    const name = toStr(args[0] ?? kwargs.name);
    const operator = resolveOp(toStr(args[1] ?? kwargs.operator));
    const operands = toStr(args[2] ?? kwargs.operands, '');
    const zoom = toNum(args[5] ?? kwargs.zoom, 0);

    const srcNames = operands.split(/\s+/).filter((s) => s.length > 0);
    const sources = srcNames
      .map((n) => maps.get(n))
      .filter((m): m is VolMap => m != null);
    if (sources.length === 0) {
      throw new Error(`map_set: no valid source maps in '${operands}'.`);
    }

    // Result grid geometry follows the first source; only voxels that exist in
    // every operand of a matching grid participate in a combine.
    const base = sources[0]!;
    const dims: Vec3 = [...base.dims];
    const n = dims[0] * dims[1] * dims[2];
    const out = new Float32Array(n);
    const sameGrid = (m: VolMap): boolean =>
      m.dims[0] === dims[0] && m.dims[1] === dims[1] && m.dims[2] === dims[2];
    const combinable = sources.filter(sameGrid);

    for (let i = 0; i < n; i++) {
      switch (operator) {
        case 'copy':
        case 'unique':
          out[i] = base.data[i] ?? 0;
          break;
        case 'minimum': {
          let v = Infinity;
          for (const m of combinable) v = Math.min(v, m.data[i] ?? 0);
          out[i] = v;
          break;
        }
        case 'maximum': {
          let v = -Infinity;
          for (const m of combinable) v = Math.max(v, m.data[i] ?? 0);
          out[i] = v;
          break;
        }
        case 'sum': {
          let v = 0;
          for (const m of combinable) v += m.data[i] ?? 0;
          out[i] = v;
          break;
        }
        case 'average': {
          let v = 0;
          for (const m of combinable) v += m.data[i] ?? 0;
          out[i] = combinable.length > 0 ? v / combinable.length : 0;
          break;
        }
        case 'difference': {
          // First operand minus the sum of the rest.
          let v = combinable[0]?.data[i] ?? 0;
          for (let k = 1; k < combinable.length; k++) v -= combinable[k]!.data[i] ?? 0;
          out[i] = v;
          break;
        }
      }
    }

    maps.set(name, {
      name,
      origin: [...base.origin],
      spacing: [...base.spacing],
      dims,
      data: out,
      levels: [],
    });
    ex.registerGadget(name, 'object:map');
    void zoom;
    ctx.publish();
    return name;
  });

  /* --------------------- isomesh / isosurface / isodot ------------------- */

  const buildIso = (kind: IsoObject['kind'], args: unknown[], kwargs: Record<string, unknown>): Json => {
    const name = toStr(args[0] ?? kwargs.name);
    const mapName = toStr(args[1] ?? kwargs.map);
    const level = toNum(args[2] ?? kwargs.level, 1);
    const m = maps.get(mapName);
    if (!m) throw new Error(`${kind}: no map named '${mapName}'`);

    const objName = ex.uniqueName(name);
    if (kind === 'dot') {
      // Grid points at/above the level become dots.
      const pts: number[] = [];
      for (let z = 0; z < m.dims[2]; z++)
        for (let y = 0; y < m.dims[1]; y++)
          for (let x = 0; x < m.dims[0]; x++) {
            if ((m.data[idx(m.dims, x, y, z)] ?? 0) >= level) {
              pts.push(
                m.origin[0] + x * m.spacing[0],
                m.origin[1] + y * m.spacing[1],
                m.origin[2] + z * m.spacing[2],
              );
            }
          }
      isoObjects.set(objName, {
        name: objName,
        verts: Float32Array.from(pts),
        indices: new Uint32Array(0),
        kind,
        level,
      });
    } else {
      const { verts, indices } = marchingCubes(m, level);
      isoObjects.set(objName, {
        name: objName,
        verts,
        indices,
        kind,
        level,
      });
    }
    const typeName =
      kind === 'mesh' ? 'object:mesh' : kind === 'surface' ? 'object:surface' : 'object:mesh';
    ex.registerGadget(objName, typeName);
    ctx.publish();
    return objName;
  };

  ctx.command('isomesh', (args, kwargs): Json => buildIso('mesh', args, kwargs));
  ctx.command('isosurface', (args, kwargs): Json => buildIso('surface', args, kwargs));
  ctx.command('isodot', (args, kwargs): Json => buildIso('dot', args, kwargs));

  /* ------------------------------- slice_new ----------------------------- */

  // `slice_new(name, map, state=1, source_state=0)` — creates a 2-D slice
  // (cutting-plane) object through a map, colored by a ramp (creating.py:680 →
  // ExecutiveSliceNew / ObjectSlice). The slice references a map by name and
  // holds no atoms; here we track it as a gadget so it appears in get_names and
  // reports `get_type == 'object:slice'`. PyMOL raises if the map is missing.
  ctx.command('slice_new', (args, kwargs): Json => {
    const name = toStr(args[0] ?? kwargs.name);
    const mapName = toStr(args[1] ?? kwargs.map);
    if (mapName && !maps.get(mapName)) {
      throw new Error(`slice_new: no map named '${mapName}'`);
    }
    ex.registerGadget(name, 'object:slice');
    ctx.publish();
    return null;
  });

  /* -------------------------------- volume ------------------------------- */

  // `volume(name, map, ramp='', selection='', buffer=0.0, state=1, carve=None,
  // source_state=0, quiet=1)` — creates a direct volume-rendering object from a
  // map (creating.py:577 → _cmd.volume / ObjectVolume). Like slice_new the
  // object references a map by name and holds no atoms; we track it as a gadget
  // so it appears in get_names and reports `get_type == 'object:volume'`. If the
  // volume object already exists it is overwritten (unlike the iso* family).
  // A `ramp` that parses as a float is consumed as a legacy `level` and cleared;
  // a remaining non-empty `ramp` triggers volume_color(name, ramp, state).
  ctx.command('volume', (args, kwargs): Json => {
    const name = toStr(args[0] ?? kwargs.name);
    const mapName = toStr(args[1] ?? kwargs.map);
    let ramp = toStr(args[2] ?? kwargs.ramp, '');
    if (mapName && !maps.get(mapName)) {
      throw new Error(`volume: no map named '${mapName}'`);
    }
    // Legacy: a bare float ramp is treated as a contour level and ignored.
    if (ramp !== '' && Number.isFinite(Number(ramp))) ramp = '';

    ex.registerGadget(name, 'object:volume');
    ctx.publish();

    if (ramp) {
      const state = toNum(args[5] ?? kwargs.state, 1);
      ctx.call('volume_color', [name, ramp, state], {});
    }
    return name;
  });

  /* -------------------------- get_isosurface_stats ----------------------- */

  ctx.command('get_isosurface_stats', (args, kwargs): Json => {
    const name = toStr(args[0] ?? kwargs.name);
    const o = isoObjects.get(name);
    if (!o) throw new Error(`get_isosurface_stats: no object named '${name}'`);
    return { verts: o.verts.length / 3, tris: o.indices.length / 3 };
  });

  /* ----------------------------- read_xplorstr --------------------------- */

  // `read_xplorstr(xplor, name, state=0, finish=1, discrete=0, quiet=1, zoom=-1)`
  // — API-only loader that reads an XPLOR ASCII map straight from a Python string
  // (importing.py:read_xplorstr → _cmd.load with loadable.xplorstr). No temp file
  // and no format sniffing. Mirrors `_cmd.load` which returns None, so this
  // returns null (unlike the read_*str molecule loaders which return the name).
  ctx.command('read_xplorstr', (args, kwargs): Json => {
    const xplor = toStr(args[0] ?? kwargs.xplor);
    const name = toStr(args[1] ?? kwargs.name) || 'map';
    const m = parseXplor(xplor, name);
    maps.set(name, m);
    ex.registerGadget(name, 'object:map');
    ctx.publish();
    return null;
  });

  /* ------------------------------ load_ccp4map --------------------------- */

  // Internal seam used by `cmd.load` to bring a CCP4/MRC binary density map into
  // the map registry (importing.py `load` → `loadable.ccp4`/`loadable.mrc` →
  // ObjectMapCCP4StrToMap). The public `load` reads the file bytes off disk and
  // delegates here so the parsed grid lands in the same store the iso*/volume
  // commands read. Registers the object as `object:map` in the executive.
  ctx.command('load_ccp4map', (args, kwargs): Json => {
    const name = toStr(args[0] ?? kwargs.name);
    const bytes = (args[1] ?? kwargs.bytes) as Uint8Array;
    const m = parseCcp4(bytes, name);
    maps.set(name, m);
    ex.registerGadget(name, 'object:map');
    ctx.publish();
    return name;
  });
}

/* ------------------------------ XPLOR parser ----------------------------- */

/**
 * Parse an XPLOR ASCII electron-density map (`layer2/ObjectMap.cpp:ObjectMapXPLORStrToMap`).
 * Layout:
 *   <blank line>
 *   NTITLE                             (int)
 *   NTITLE title lines
 *   NA AMIN AMAX  NB BMIN BMAX  NC CMIN CMAX   (9 ints — grid + index ranges)
 *   A B C ALPHA BETA GAMMA             (6 floats — unit cell)
 *   ZYX
 *   for each C section (kc = CMIN..CMAX):
 *     <section index>                  (int)
 *     (AMAX-AMIN+1)*(BMAX-BMIN+1) floats, A fastest then B, 6 per line
 *   -9999
 *   <average> <sigma>
 * Values are stored A-fastest, then B, then C, matching {@link idx}. The unit
 * cell is treated as orthorhombic (spacing = axis/N); non-90° cells would need a
 * skew matrix the VolMap grid does not model.
 */
function parseXplor(text: string, name: string): VolMap {
  // Flatten to whitespace-separated tokens, but keep the ZYX marker findable.
  const lines = text.split(/\r?\n/);
  let li = 0;
  const nextNonEmpty = (): string => {
    while (li < lines.length && lines[li]!.trim() === '') li++;
    return li < lines.length ? lines[li++]! : '';
  };

  const ntitle = parseInt(nextNonEmpty().trim(), 10);
  if (!Number.isFinite(ntitle)) throw new Error('read_xplorstr: bad title count');
  for (let i = 0; i < ntitle; i++) li++; // skip title lines (may be blank)

  const gridTok = (lines[li++] ?? '').trim().split(/\s+/).map(Number);
  if (gridTok.length < 9 || gridTok.some((v) => !Number.isFinite(v))) {
    throw new Error('read_xplorstr: bad grid header');
  }
  const [na, amin, amax, nb, bmin, bmax, nc, cmin, cmax] = gridTok as number[];

  const cellTok = (lines[li++] ?? '').trim().split(/\s+/).map(Number);
  if (cellTok.length < 6 || cellTok.some((v) => !Number.isFinite(v))) {
    throw new Error('read_xplorstr: bad unit-cell line');
  }
  const [ca, cb, cc] = cellTok as number[];

  // The "ZYX" ordering marker.
  const marker = (lines[li++] ?? '').trim().toUpperCase();
  if (marker !== 'ZYX') throw new Error(`read_xplorstr: expected ZYX, got '${marker}'`);

  const nx = amax! - amin! + 1;
  const ny = bmax! - bmin! + 1;
  const nz = cmax! - cmin! + 1;
  const dims: Vec3 = [nx, ny, nz];
  const data = new Float32Array(nx * ny * nz);

  // Remaining tokens are the per-section index headers interleaved with data.
  const rest: number[] = [];
  for (; li < lines.length; li++) {
    const t = lines[li]!.trim();
    if (t === '') continue;
    for (const s of t.split(/\s+/)) {
      const n = Number(s);
      if (Number.isFinite(n)) rest.push(n);
    }
  }
  const perSection = nx * ny;
  let ri = 0;
  for (let z = 0; z < nz; z++) {
    ri++; // section index header (one integer per section)
    for (let s = 0; s < perSection; s++) {
      const x = s % nx;
      const y = Math.floor(s / nx);
      data[idx(dims, x, y, z)] = rest[ri++] ?? 0;
    }
  }
  // A trailing `-9999` sentinel and the average/sigma pair follow; ignored.

  const spacing: Vec3 = [ca! / na!, cb! / nb!, cc! / nc!];
  const origin: Vec3 = [amin! * spacing[0], bmin! * spacing[1], cmin! * spacing[2]];
  return { name, origin, spacing, dims, data, levels: [] };
}

/* ------------------------------ CCP4/MRC parser -------------------------- */

/**
 * Parse a CCP4 / MRC binary electron-density map
 * (`layer2/ObjectMap.cpp:ObjectMapCCP4StrToMap`). The 1024-byte header is 256
 * little-endian 32-bit words:
 *   0..2   NC, NR, NS      grid columns/rows/sections (fast→slow axis)
 *   3      MODE            0=int8, 1=int16, 2=float32, 6=uint16
 *   4..6   NCSTART…        start index of column/row/section
 *   7..9   MX, MY, MZ      sampling (grid) intervals along cell axes X,Y,Z
 *   10..15 cell a,b,c,α,β,γ (floats)
 *   16..18 MAPC, MAPR, MAPS which cell axis (1=X,2=Y,3=Z) is column/row/section
 *   23     NSYMBT          bytes of symmetry records after the header
 *   49..51 ORIGIN x,y,z    (MRC2000 origin, floats)
 * Density follows at byte 1024+NSYMBT, column-fastest. The grid is treated as
 * orthorhombic (spacing = cell_axis / sampling); skewed cells are not modelled.
 */
function parseCcp4(bytes: Uint8Array, name: string): VolMap {
  if (bytes.length < 1024) throw new Error('load: CCP4/MRC file is too small for a header');
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const i32 = (w: number): number => dv.getInt32(w * 4, true);
  const f32 = (w: number): number => dv.getFloat32(w * 4, true);

  const nc = i32(0);
  const nr = i32(1);
  const ns = i32(2);
  const mode = i32(3);
  const start: Vec3 = [i32(4), i32(5), i32(6)];
  const sampling: Vec3 = [i32(7), i32(8), i32(9)];
  const cell: Vec3 = [f32(10), f32(11), f32(12)];
  const mapc = i32(16);
  const mapr = i32(17);
  const maps_ = i32(18);
  const nsymbt = i32(23);
  const mrcOrigin: Vec3 = [f32(49), f32(50), f32(51)];

  if (nc <= 0 || nr <= 0 || ns <= 0 || nc * nr * ns > 1 << 30) {
    throw new Error('load: CCP4/MRC header has an implausible grid size');
  }

  // Map the column/row/section axes onto X/Y/Z via MAPC/MAPR/MAPS (default
  // 1,2,3 = already X,Y,Z). `axisOf[k]` is the cell axis (0/1/2) of the k-th
  // stored axis (0=column,1=row,2=section).
  const axisOf: [number, number, number] = [
    (mapc || 1) - 1,
    (mapr || 2) - 1,
    (maps_ || 3) - 1,
  ];
  const storedDims: [number, number, number] = [nc, nr, ns];
  const dims: Vec3 = [0, 0, 0];
  const spacing: Vec3 = [1, 1, 1];
  const origin: Vec3 = [0, 0, 0];
  for (let k = 0; k < 3; k++) {
    const a = axisOf[k]!;
    dims[a] = storedDims[k]!;
    const samp = sampling[a] || storedDims[k]!;
    const sp = samp > 0 ? cell[a]! / samp : 1;
    spacing[a] = sp;
    origin[a] = mrcOrigin[a] !== 0 ? mrcOrigin[a]! : start[k]! * sp;
  }

  const n = nc * nr * ns;
  const dataStart = 1024 + Math.max(0, nsymbt);
  const data = new Float32Array(n);
  // Read column-fastest (stored order) and scatter into X/Y/Z grid order.
  const readVal =
    mode === 2
      ? (o: number): number => dv.getFloat32(dataStart + o * 4, true)
      : mode === 1
        ? (o: number): number => dv.getInt16(dataStart + o * 2, true)
        : mode === 6
          ? (o: number): number => dv.getUint16(dataStart + o * 2, true)
          : (o: number): number => dv.getInt8(dataStart + o); // mode 0 (int8)
  const bytesPer = mode === 2 ? 4 : mode === 1 || mode === 6 ? 2 : 1;
  if (dataStart + n * bytesPer > bytes.length) {
    throw new Error('load: CCP4/MRC file is truncated (density shorter than header claims)');
  }
  // If the stored axes are already X,Y,Z (the common case) copy straight through;
  // otherwise permute each cell into its X/Y/Z slot.
  const identity = axisOf[0] === 0 && axisOf[1] === 1 && axisOf[2] === 2;
  let o = 0;
  for (let s = 0; s < ns; s++) {
    for (let r = 0; r < nr; r++) {
      for (let c = 0; c < nc; c++, o++) {
        if (identity) {
          data[o] = readVal(o);
        } else {
          const stored: [number, number, number] = [c, r, s];
          const gx = stored[axisOf.indexOf(0) as 0 | 1 | 2]!;
          const gy = stored[axisOf.indexOf(1) as 0 | 1 | 2]!;
          const gz = stored[axisOf.indexOf(2) as 0 | 1 | 2]!;
          data[idx(dims, gx, gy, gz)] = readVal(o);
        }
      }
    }
  }
  return { name, origin, spacing, dims, data, levels: [] };
}

/* ---------------------------- grid resampling ---------------------------- */

/**
 * Uniformly double (`dir=+1`) or halve (`dir=-1`) a map in place.
 *   double: dims -> 2*dims-1, spacing -> spacing/2, trilinear interpolation.
 *   halve : dims -> floor(dims/2), spacing -> spacing*2, take every other point.
 */
function resampleUniform(m: VolMap, dir: 1 | -1): void {
  const old = m.dims;
  if (dir === -1) {
    const nd: Vec3 = [
      Math.max(1, Math.floor(old[0] / 2)),
      Math.max(1, Math.floor(old[1] / 2)),
      Math.max(1, Math.floor(old[2] / 2)),
    ];
    const data = new Float32Array(nd[0] * nd[1] * nd[2]);
    for (let z = 0; z < nd[2]; z++)
      for (let y = 0; y < nd[1]; y++)
        for (let x = 0; x < nd[0]; x++)
          data[idx(nd, x, y, z)] = m.data[idx(old, x * 2, y * 2, z * 2)] ?? 0;
    m.dims = nd;
    m.spacing = [m.spacing[0] * 2, m.spacing[1] * 2, m.spacing[2] * 2];
    m.data = data;
    return;
  }
  const nd: Vec3 = [old[0] * 2 - 1, old[1] * 2 - 1, old[2] * 2 - 1];
  const data = new Float32Array(nd[0] * nd[1] * nd[2]);
  const sample = (fx: number, fy: number, fz: number): number => {
    const x0 = Math.floor(fx),
      y0 = Math.floor(fy),
      z0 = Math.floor(fz);
    const x1 = Math.min(x0 + 1, old[0] - 1),
      y1 = Math.min(y0 + 1, old[1] - 1),
      z1 = Math.min(z0 + 1, old[2] - 1);
    const tx = fx - x0,
      ty = fy - y0,
      tz = fz - z0;
    const c = (xx: number, yy: number, zz: number): number => m.data[idx(old, xx, yy, zz)] ?? 0;
    const c00 = c(x0, y0, z0) * (1 - tx) + c(x1, y0, z0) * tx;
    const c10 = c(x0, y1, z0) * (1 - tx) + c(x1, y1, z0) * tx;
    const c01 = c(x0, y0, z1) * (1 - tx) + c(x1, y0, z1) * tx;
    const c11 = c(x0, y1, z1) * (1 - tx) + c(x1, y1, z1) * tx;
    const c0 = c00 * (1 - ty) + c10 * ty;
    const c1 = c01 * (1 - ty) + c11 * ty;
    return c0 * (1 - tz) + c1 * tz;
  };
  for (let z = 0; z < nd[2]; z++)
    for (let y = 0; y < nd[1]; y++)
      for (let x = 0; x < nd[0]; x++) data[idx(nd, x, y, z)] = sample(x / 2, y / 2, z / 2);
  m.dims = nd;
  m.spacing = [m.spacing[0] / 2, m.spacing[1] / 2, m.spacing[2] / 2];
  m.data = data;
}

/* ----------------------------- marching cubes ---------------------------- */

/** Corner offsets, standard MC numbering. */
const CORNER: ReadonlyArray<Vec3> = [
  [0, 0, 0],
  [1, 0, 0],
  [1, 1, 0],
  [0, 1, 0],
  [0, 0, 1],
  [1, 0, 1],
  [1, 1, 1],
  [0, 1, 1],
];
/** Edge -> the two corners it joins. */
const EDGE_CONN: ReadonlyArray<[number, number]> = [
  [0, 1],
  [1, 2],
  [2, 3],
  [3, 0],
  [4, 5],
  [5, 6],
  [6, 7],
  [7, 4],
  [0, 4],
  [1, 5],
  [2, 6],
  [3, 7],
];

/**
 * Standard 256-case marching cubes over a scalar grid. A corner is "inside"
 * when its value is BELOW `level`; each cube's intersected edges come straight
 * from {@link TRI_TABLE}. Vertices are shared within a cube via an edge cache;
 * across cubes they are emitted independently (fine for counting/rendering).
 */
function marchingCubes(m: VolMap, level: number): { verts: Float32Array; indices: Uint32Array } {
  const { dims, origin, spacing, data } = m;
  const verts: number[] = [];
  const indices: number[] = [];

  const val = (x: number, y: number, z: number): number => data[idx(dims, x, y, z)] ?? 0;

  for (let z = 0; z < dims[2] - 1; z++) {
    for (let y = 0; y < dims[1] - 1; y++) {
      for (let x = 0; x < dims[0] - 1; x++) {
        const cv: number[] = new Array(8);
        let cubeIndex = 0;
        for (let c = 0; c < 8; c++) {
          const off = CORNER[c]!;
          const v = val(x + off[0], y + off[1], z + off[2]);
          cv[c] = v;
          if (v < level) cubeIndex |= 1 << c;
        }
        const tris = TRI_TABLE[cubeIndex]!;
        if (tris.length === 0) continue;

        // Interpolated vertex per intersected edge, cached within the cube.
        const edgeVert: Array<number | undefined> = new Array(12);
        const vertexForEdge = (e: number): number => {
          const cached = edgeVert[e];
          if (cached !== undefined) return cached;
          const [a, b] = EDGE_CONN[e]!;
          const oa = CORNER[a]!;
          const ob = CORNER[b]!;
          const va = cv[a]!;
          const vb = cv[b]!;
          let t = 0.5;
          const denom = vb - va;
          if (Math.abs(denom) > 1e-12) t = (level - va) / denom;
          if (t < 0) t = 0;
          if (t > 1) t = 1;
          const ax = x + oa[0],
            ay = y + oa[1],
            az = z + oa[2];
          const bx = x + ob[0],
            by = y + ob[1],
            bz = z + ob[2];
          const gx = ax + (bx - ax) * t;
          const gy = ay + (by - ay) * t;
          const gz = az + (bz - az) * t;
          const vi = verts.length / 3;
          verts.push(
            origin[0] + gx * spacing[0],
            origin[1] + gy * spacing[1],
            origin[2] + gz * spacing[2],
          );
          edgeVert[e] = vi;
          return vi;
        };

        for (let i = 0; i < tris.length; i += 3) {
          indices.push(
            vertexForEdge(tris[i]!),
            vertexForEdge(tris[i + 1]!),
            vertexForEdge(tris[i + 2]!),
          );
        }
      }
    }
  }
  return { verts: Float32Array.from(verts), indices: Uint32Array.from(indices) };
}

/**
 * The canonical marching-cubes triangle table (Paul Bourke / Lorensen-Cline).
 * `TRI_TABLE[cubeIndex]` is a flat list of edge indices, three per triangle.
 * `-1` terminators are stripped so each row is directly iterable.
 */
const TRI_TABLE_RAW: ReadonlyArray<ReadonlyArray<number>> = [
  [],
  [0, 8, 3],
  [0, 1, 9],
  [1, 8, 3, 9, 8, 1],
  [1, 2, 10],
  [0, 8, 3, 1, 2, 10],
  [9, 2, 10, 0, 2, 9],
  [2, 8, 3, 2, 10, 8, 10, 9, 8],
  [3, 11, 2],
  [0, 11, 2, 8, 11, 0],
  [1, 9, 0, 2, 3, 11],
  [1, 11, 2, 1, 9, 11, 9, 8, 11],
  [3, 10, 1, 11, 10, 3],
  [0, 10, 1, 0, 8, 10, 8, 11, 10],
  [3, 9, 0, 3, 11, 9, 11, 10, 9],
  [9, 8, 10, 10, 8, 11],
  [4, 7, 8],
  [4, 3, 0, 7, 3, 4],
  [0, 1, 9, 8, 4, 7],
  [4, 1, 9, 4, 7, 1, 7, 3, 1],
  [1, 2, 10, 8, 4, 7],
  [3, 4, 7, 3, 0, 4, 1, 2, 10],
  [9, 2, 10, 9, 0, 2, 8, 4, 7],
  [2, 10, 9, 2, 9, 7, 2, 7, 3, 7, 9, 4],
  [8, 4, 7, 3, 11, 2],
  [11, 4, 7, 11, 2, 4, 2, 0, 4],
  [9, 0, 1, 8, 4, 7, 2, 3, 11],
  [4, 7, 11, 9, 4, 11, 9, 11, 2, 9, 2, 1],
  [3, 10, 1, 3, 11, 10, 7, 8, 4],
  [1, 11, 10, 1, 4, 11, 1, 0, 4, 7, 11, 4],
  [4, 7, 8, 9, 0, 11, 9, 11, 10, 11, 0, 3],
  [4, 7, 11, 4, 11, 9, 9, 11, 10],
  [9, 5, 4],
  [9, 5, 4, 0, 8, 3],
  [0, 5, 4, 1, 5, 0],
  [8, 5, 4, 8, 3, 5, 3, 1, 5],
  [1, 2, 10, 9, 5, 4],
  [3, 0, 8, 1, 2, 10, 4, 9, 5],
  [5, 2, 10, 5, 4, 2, 4, 0, 2],
  [2, 10, 5, 3, 2, 5, 3, 5, 4, 3, 4, 8],
  [9, 5, 4, 2, 3, 11],
  [0, 11, 2, 0, 8, 11, 4, 9, 5],
  [0, 5, 4, 0, 1, 5, 2, 3, 11],
  [2, 1, 5, 2, 5, 8, 2, 8, 11, 4, 8, 5],
  [10, 3, 11, 10, 1, 3, 9, 5, 4],
  [4, 9, 5, 0, 8, 1, 8, 10, 1, 8, 11, 10],
  [5, 4, 0, 5, 0, 11, 5, 11, 10, 11, 0, 3],
  [5, 4, 8, 5, 8, 10, 10, 8, 11],
  [9, 7, 8, 5, 7, 9],
  [9, 3, 0, 9, 5, 3, 5, 7, 3],
  [0, 7, 8, 0, 1, 7, 1, 5, 7],
  [1, 5, 3, 3, 5, 7],
  [9, 7, 8, 9, 5, 7, 10, 1, 2],
  [10, 1, 2, 9, 5, 0, 5, 3, 0, 5, 7, 3],
  [8, 0, 2, 8, 2, 5, 8, 5, 7, 10, 5, 2],
  [2, 10, 5, 2, 5, 3, 3, 5, 7],
  [7, 9, 5, 7, 8, 9, 3, 11, 2],
  [9, 5, 7, 9, 7, 2, 9, 2, 0, 2, 7, 11],
  [2, 3, 11, 0, 1, 8, 1, 7, 8, 1, 5, 7],
  [11, 2, 1, 11, 1, 7, 7, 1, 5],
  [9, 5, 8, 8, 5, 7, 10, 1, 3, 10, 3, 11],
  [5, 7, 0, 5, 0, 9, 7, 11, 0, 1, 0, 10, 11, 10, 0],
  [11, 10, 0, 11, 0, 3, 10, 5, 0, 8, 0, 7, 5, 7, 0],
  [11, 10, 5, 7, 11, 5],
  [10, 6, 5],
  [0, 8, 3, 5, 10, 6],
  [9, 0, 1, 5, 10, 6],
  [1, 8, 3, 1, 9, 8, 5, 10, 6],
  [1, 6, 5, 2, 6, 1],
  [1, 6, 5, 1, 2, 6, 3, 0, 8],
  [9, 6, 5, 9, 0, 6, 0, 2, 6],
  [5, 9, 8, 5, 8, 2, 5, 2, 6, 3, 2, 8],
  [2, 3, 11, 10, 6, 5],
  [11, 0, 8, 11, 2, 0, 10, 6, 5],
  [0, 1, 9, 2, 3, 11, 5, 10, 6],
  [5, 10, 6, 1, 9, 2, 9, 11, 2, 9, 8, 11],
  [6, 3, 11, 6, 5, 3, 5, 1, 3],
  [0, 8, 11, 0, 11, 5, 0, 5, 1, 5, 11, 6],
  [3, 11, 6, 0, 3, 6, 0, 6, 5, 0, 5, 9],
  [6, 5, 9, 6, 9, 11, 11, 9, 8],
  [5, 10, 6, 4, 7, 8],
  [4, 3, 0, 4, 7, 3, 6, 5, 10],
  [1, 9, 0, 5, 10, 6, 8, 4, 7],
  [10, 6, 5, 1, 9, 7, 1, 7, 3, 7, 9, 4],
  [6, 1, 2, 6, 5, 1, 4, 7, 8],
  [1, 2, 5, 5, 2, 6, 3, 0, 4, 3, 4, 7],
  [8, 4, 7, 9, 0, 5, 0, 6, 5, 0, 2, 6],
  [7, 3, 9, 7, 9, 4, 3, 2, 9, 5, 9, 6, 2, 6, 9],
  [3, 11, 2, 7, 8, 4, 10, 6, 5],
  [5, 10, 6, 4, 7, 2, 4, 2, 0, 2, 7, 11],
  [0, 1, 9, 4, 7, 8, 2, 3, 11, 5, 10, 6],
  [9, 2, 1, 9, 11, 2, 9, 4, 11, 7, 11, 4, 5, 10, 6],
  [8, 4, 7, 3, 11, 5, 3, 5, 1, 5, 11, 6],
  [5, 1, 11, 5, 11, 6, 1, 0, 11, 7, 11, 4, 0, 4, 11],
  [0, 5, 9, 0, 6, 5, 0, 3, 6, 11, 6, 3, 8, 4, 7],
  [6, 5, 9, 6, 9, 11, 4, 7, 9, 7, 11, 9],
  [10, 4, 9, 6, 4, 10],
  [4, 10, 6, 4, 9, 10, 0, 8, 3],
  [10, 0, 1, 10, 6, 0, 6, 4, 0],
  [8, 3, 1, 8, 1, 6, 8, 6, 4, 6, 1, 10],
  [1, 4, 9, 1, 2, 4, 2, 6, 4],
  [3, 0, 8, 1, 2, 9, 2, 4, 9, 2, 6, 4],
  [0, 2, 4, 4, 2, 6],
  [8, 3, 2, 8, 2, 4, 4, 2, 6],
  [10, 4, 9, 10, 6, 4, 11, 2, 3],
  [0, 8, 2, 2, 8, 11, 4, 9, 10, 4, 10, 6],
  [3, 11, 2, 0, 1, 6, 0, 6, 4, 6, 1, 10],
  [6, 4, 1, 6, 1, 10, 4, 8, 1, 2, 1, 11, 8, 11, 1],
  [9, 6, 4, 9, 3, 6, 9, 1, 3, 11, 6, 3],
  [8, 11, 1, 8, 1, 0, 11, 6, 1, 9, 1, 4, 6, 4, 1],
  [3, 11, 6, 3, 6, 0, 0, 6, 4],
  [6, 4, 8, 11, 6, 8],
  [7, 10, 6, 7, 8, 10, 8, 9, 10],
  [0, 7, 3, 0, 10, 7, 0, 9, 10, 6, 7, 10],
  [10, 6, 7, 1, 10, 7, 1, 7, 8, 1, 8, 0],
  [10, 6, 7, 10, 7, 1, 1, 7, 3],
  [1, 2, 6, 1, 6, 8, 1, 8, 9, 8, 6, 7],
  [2, 6, 9, 2, 9, 1, 6, 7, 9, 0, 9, 3, 7, 3, 9],
  [7, 8, 0, 7, 0, 6, 6, 0, 2],
  [7, 3, 2, 6, 7, 2],
  [2, 3, 11, 10, 6, 8, 10, 8, 9, 8, 6, 7],
  [2, 0, 7, 2, 7, 11, 0, 9, 7, 6, 7, 10, 9, 10, 7],
  [1, 8, 0, 1, 7, 8, 1, 10, 7, 6, 7, 10, 2, 3, 11],
  [11, 2, 1, 11, 1, 7, 10, 6, 1, 6, 7, 1],
  [8, 9, 6, 8, 6, 7, 9, 1, 6, 11, 6, 3, 1, 3, 6],
  [0, 9, 1, 11, 6, 7],
  [7, 8, 0, 7, 0, 6, 3, 11, 0, 11, 6, 0],
  [7, 11, 6],
  [7, 6, 11],
  [3, 0, 8, 11, 7, 6],
  [0, 1, 9, 11, 7, 6],
  [8, 1, 9, 8, 3, 1, 11, 7, 6],
  [10, 1, 2, 6, 11, 7],
  [1, 2, 10, 3, 0, 8, 6, 11, 7],
  [2, 9, 0, 2, 10, 9, 6, 11, 7],
  [6, 11, 7, 2, 10, 3, 10, 8, 3, 10, 9, 8],
  [7, 2, 3, 6, 2, 7],
  [7, 0, 8, 7, 6, 0, 6, 2, 0],
  [2, 7, 6, 2, 3, 7, 0, 1, 9],
  [1, 6, 2, 1, 8, 6, 1, 9, 8, 8, 7, 6],
  [10, 7, 6, 10, 1, 7, 1, 3, 7],
  [10, 7, 6, 1, 7, 10, 1, 8, 7, 1, 0, 8],
  [0, 3, 7, 0, 7, 10, 0, 10, 9, 6, 10, 7],
  [7, 6, 10, 7, 10, 8, 8, 10, 9],
  [6, 8, 4, 11, 8, 6],
  [3, 6, 11, 3, 0, 6, 0, 4, 6],
  [8, 6, 11, 8, 4, 6, 9, 0, 1],
  [9, 4, 6, 9, 6, 3, 9, 3, 1, 11, 3, 6],
  [6, 8, 4, 6, 11, 8, 2, 10, 1],
  [1, 2, 10, 3, 0, 11, 0, 6, 11, 0, 4, 6],
  [4, 11, 8, 4, 6, 11, 0, 2, 9, 2, 10, 9],
  [10, 9, 3, 10, 3, 2, 9, 4, 3, 11, 3, 6, 4, 6, 3],
  [8, 2, 3, 8, 4, 2, 4, 6, 2],
  [0, 4, 2, 4, 6, 2],
  [1, 9, 0, 2, 3, 4, 2, 4, 6, 4, 3, 8],
  [1, 9, 4, 1, 4, 2, 2, 4, 6],
  [8, 1, 3, 8, 6, 1, 8, 4, 6, 6, 10, 1],
  [10, 1, 0, 10, 0, 6, 6, 0, 4],
  [4, 6, 3, 4, 3, 8, 6, 10, 3, 0, 3, 9, 10, 9, 3],
  [10, 9, 4, 6, 10, 4],
  [4, 9, 5, 7, 6, 11],
  [0, 8, 3, 4, 9, 5, 11, 7, 6],
  [5, 0, 1, 5, 4, 0, 7, 6, 11],
  [11, 7, 6, 8, 3, 4, 3, 5, 4, 3, 1, 5],
  [9, 5, 4, 10, 1, 2, 7, 6, 11],
  [6, 11, 7, 1, 2, 10, 0, 8, 3, 4, 9, 5],
  [7, 6, 11, 5, 4, 10, 4, 2, 10, 4, 0, 2],
  [3, 4, 8, 3, 5, 4, 3, 2, 5, 10, 5, 2, 11, 7, 6],
  [7, 2, 3, 7, 6, 2, 5, 4, 9],
  [9, 5, 4, 0, 8, 6, 0, 6, 2, 6, 8, 7],
  [3, 6, 2, 3, 7, 6, 1, 5, 0, 5, 4, 0],
  [6, 2, 8, 6, 8, 7, 2, 1, 8, 4, 8, 5, 1, 5, 8],
  [9, 5, 4, 10, 1, 6, 1, 7, 6, 1, 3, 7],
  [1, 6, 10, 1, 7, 6, 1, 0, 7, 8, 7, 0, 9, 5, 4],
  [4, 0, 10, 4, 10, 5, 0, 3, 10, 6, 10, 7, 3, 7, 10],
  [7, 6, 10, 7, 10, 8, 5, 4, 10, 4, 8, 10],
  [6, 9, 5, 6, 11, 9, 11, 8, 9],
  [3, 6, 11, 0, 6, 3, 0, 5, 6, 0, 9, 5],
  [0, 11, 8, 0, 5, 11, 0, 1, 5, 5, 6, 11],
  [6, 11, 3, 6, 3, 5, 5, 3, 1],
  [1, 2, 10, 9, 5, 11, 9, 11, 8, 11, 5, 6],
  [0, 11, 3, 0, 6, 11, 0, 9, 6, 5, 6, 9, 1, 2, 10],
  [11, 8, 5, 11, 5, 6, 8, 0, 5, 10, 5, 2, 0, 2, 5],
  [6, 11, 3, 6, 3, 5, 2, 10, 3, 10, 5, 3],
  [5, 8, 9, 5, 2, 8, 5, 6, 2, 3, 8, 2],
  [9, 5, 6, 9, 6, 0, 0, 6, 2],
  [1, 5, 8, 1, 8, 0, 5, 6, 8, 3, 8, 2, 6, 2, 8],
  [1, 5, 6, 2, 1, 6],
  [1, 3, 6, 1, 6, 10, 3, 8, 6, 5, 6, 9, 8, 9, 6],
  [10, 1, 0, 10, 0, 6, 9, 5, 0, 5, 6, 0],
  [0, 3, 8, 5, 6, 10],
  [10, 5, 6],
  [11, 5, 10, 7, 5, 11],
  [11, 5, 10, 11, 7, 5, 8, 3, 0],
  [5, 11, 7, 5, 10, 11, 1, 9, 0],
  [10, 7, 5, 10, 11, 7, 9, 8, 1, 8, 3, 1],
  [11, 1, 2, 11, 7, 1, 7, 5, 1],
  [0, 8, 3, 1, 2, 7, 1, 7, 5, 7, 2, 11],
  [9, 7, 5, 9, 2, 7, 9, 0, 2, 2, 11, 7],
  [7, 5, 2, 7, 2, 11, 5, 9, 2, 3, 2, 8, 9, 8, 2],
  [2, 5, 10, 2, 3, 5, 3, 7, 5],
  [8, 2, 0, 8, 5, 2, 8, 7, 5, 10, 2, 5],
  [9, 0, 1, 5, 10, 3, 5, 3, 7, 3, 10, 2],
  [9, 8, 2, 9, 2, 1, 8, 7, 2, 10, 2, 5, 7, 5, 2],
  [1, 3, 5, 3, 7, 5],
  [0, 8, 7, 0, 7, 1, 1, 7, 5],
  [9, 0, 3, 9, 3, 5, 5, 3, 7],
  [9, 8, 7, 5, 9, 7],
  [5, 8, 4, 5, 10, 8, 10, 11, 8],
  [5, 0, 4, 5, 11, 0, 5, 10, 11, 11, 3, 0],
  [0, 1, 9, 8, 4, 10, 8, 10, 11, 10, 4, 5],
  [10, 11, 4, 10, 4, 5, 11, 3, 4, 9, 4, 1, 3, 1, 4],
  [2, 5, 1, 2, 8, 5, 2, 11, 8, 4, 5, 8],
  [0, 4, 11, 0, 11, 3, 4, 5, 11, 2, 11, 1, 5, 1, 11],
  [0, 2, 5, 0, 5, 9, 2, 11, 5, 4, 5, 8, 11, 8, 5],
  [9, 4, 5, 2, 11, 3],
  [2, 5, 10, 3, 5, 2, 3, 4, 5, 3, 8, 4],
  [5, 10, 2, 5, 2, 4, 4, 2, 0],
  [3, 10, 2, 3, 5, 10, 3, 8, 5, 4, 5, 8, 0, 1, 9],
  [5, 10, 2, 5, 2, 4, 1, 9, 2, 9, 4, 2],
  [8, 4, 5, 8, 5, 3, 3, 5, 1],
  [0, 4, 5, 1, 0, 5],
  [8, 4, 5, 8, 5, 3, 9, 0, 5, 0, 3, 5],
  [9, 4, 5],
  [4, 11, 7, 4, 9, 11, 9, 10, 11],
  [0, 8, 3, 4, 9, 7, 9, 11, 7, 9, 10, 11],
  [1, 10, 11, 1, 11, 4, 1, 4, 0, 7, 4, 11],
  [3, 1, 4, 3, 4, 8, 1, 10, 4, 7, 4, 11, 10, 11, 4],
  [4, 11, 7, 9, 11, 4, 9, 2, 11, 9, 1, 2],
  [9, 7, 4, 9, 11, 7, 9, 1, 11, 2, 11, 1, 0, 8, 3],
  [11, 7, 4, 11, 4, 2, 2, 4, 0],
  [11, 7, 4, 11, 4, 2, 8, 3, 4, 3, 2, 4],
  [2, 9, 10, 2, 7, 9, 2, 3, 7, 7, 4, 9],
  [9, 10, 7, 9, 7, 4, 10, 2, 7, 8, 7, 0, 2, 0, 7],
  [3, 7, 10, 3, 10, 2, 7, 4, 10, 1, 10, 0, 4, 0, 10],
  [1, 10, 2, 8, 7, 4],
  [4, 9, 1, 4, 1, 7, 7, 1, 3],
  [4, 9, 1, 4, 1, 7, 0, 8, 1, 8, 7, 1],
  [4, 0, 3, 7, 4, 3],
  [4, 8, 7],
  [9, 10, 8, 10, 11, 8],
  [3, 0, 9, 3, 9, 11, 11, 9, 10],
  [0, 1, 10, 0, 10, 8, 8, 10, 11],
  [3, 1, 10, 11, 3, 10],
  [1, 2, 11, 1, 11, 9, 9, 11, 8],
  [3, 0, 9, 3, 9, 11, 1, 2, 9, 2, 11, 9],
  [0, 2, 11, 8, 0, 11],
  [3, 2, 11],
  [2, 3, 8, 2, 8, 10, 10, 8, 9],
  [9, 10, 2, 0, 9, 2],
  [2, 3, 8, 2, 8, 10, 0, 1, 8, 1, 10, 8],
  [1, 10, 2],
  [1, 3, 8, 9, 1, 8],
  [0, 9, 1],
  [0, 3, 8],
  [],
];

const TRI_TABLE: ReadonlyArray<ReadonlyArray<number>> = TRI_TABLE_RAW;
