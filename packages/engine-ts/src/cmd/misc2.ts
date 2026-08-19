/**
 * More flat verbs: preset aliases (pretty/simple/technical/publication), label2, dirty/dirty_wizard, finish_object, and the colorection (named colour-selection) set.
 *
 * Registers through the shared {@link RegistrarCtx}. Compose real verbs via
 * `ctx.call(...)`; simple state via `ctx.executive`; `ctx.publish()` after
 * mutations.
 */
import type { Json } from '@tenmol/protocol';
import type { RegistrarCtx } from './registrar';

/* ------------------------------ colorection store ------------------------- */

/**
 * A saved colour scheme (PyMOL "colorection" = colour-section). Faithful-but-
 * simple shape: one `[objName, atomId, colorIndex]` triple per atom snapshotted
 * at `get_colorection` time. PyMOL keys its colorection by colour index -> atom
 * list; here we snapshot per-atom so a later `set_colorection` can restore the
 * exact `atom.color` each atom carried, matched back by stable identity
 * (`objName|id`). Stored in a Map keyed by prefix that is created PER
 * `registerMisc2` call — i.e. per {@link Engine} instance — so two engines in
 * one process never share or clobber each other's saved colour schemes (unlike
 * a module-level Map, which the default `''` prefix would collide across).
 */
type ColorSnapshot = Array<[string, number, number]>;

/** The prefix a colorection call addresses: explicit `prefix` arg, else a
 *  string first arg (PyMOL's `set/get/del_colorection(name)`), else ''. */
function prefixOf(args: unknown[], str: RegistrarCtx['str']): string {
  const first = args[0];
  return str(args[1] ?? (typeof first === 'string' ? first : ''), '');
}

export function registerMisc2(ctx: RegistrarCtx): void {
  const ex = ctx.executive;
  const { str } = ctx;

  // Instance-scoped colorection store (see the module doc): one Map per engine.
  const COLORECTIONS = new Map<string, ColorSnapshot>();

  /* --------------------------- preset aliases --------------------------- */
  // PyMOL re-exports these presets as flat top-level verbs; each forwards its
  // selection (default 'all') to the matching `preset.*` orchestrator.
  const PRESET_ALIASES = ['pretty', 'simple', 'technical', 'publication'] as const;
  for (const name of PRESET_ALIASES) {
    ctx.command(name, (args): Json => ctx.call(`preset.${name}`, [str(args[0], 'all') || 'all']));
  }

  /* -------------------------------- label2 ------------------------------ */
  // A variant spelling of `label`; forward args + kwargs to the real verb.
  ctx.command('label2', (args, kwargs): Json => ctx.call('label', args, kwargs));

  /* ------------------- dirty / dirty_wizard / finish_object ------------- */
  // PyMOL's `dirty` flags the scene for redraw; the engine re-emits by
  // publishing. `finish_object` finalises a just-built object — same effect
  // here: re-publish so its geometry is emitted.
  const republish = (): Json => {
    ctx.publish();
    return null;
  };
  ctx.command('dirty', republish);
  ctx.command('dirty_wizard', republish);
  ctx.command('finish_object', republish);

  /* ---------------------------- colorection API ------------------------- */

  // get_colorection(prefix): snapshot the current colour of every atom and
  // store it under `prefix`, returning a copy of the snapshot.
  ctx.command('get_colorection', (args): Json => {
    const prefix = prefixOf(args, str);
    const snap: ColorSnapshot = ex
      .atomsMatching('all')
      .map((ua) => [ua.objName, ua.atom.id, ua.atom.color]);
    COLORECTIONS.set(prefix, snap);
    return snap.map((t) => [...t]);
  });

  // set_colorection(dict_or_name, prefix): restore atom colours. Accepts three
  // shapes:
  //   * PyMOL's native flat colorection `[color0, sele0, color1, sele1, …]` (a
  //     list of int pairs, exactly what `get_colorection` returns in real
  //     PyMOL). Each pair names a stored selection `_!c_<prefix>_<color>` holding
  //     the atoms that carried `<color>` when `<prefix>` was snapshotted; the
  //     verb recolours those atoms back to `<color>`. We recover that membership
  //     from the per-atom snapshot saved under the prefix.
  //   * the engine's own per-atom snapshot `[[objName, id, color], …]` passed
  //     directly (elements are triples/arrays).
  //   * `null`/name → the snapshot stored under `prefix`.
  ctx.command('set_colorection', (args): Json => {
    const first = args[0];
    const applySnapshot = (snap: ColorSnapshot, wanted?: Set<number>): void => {
      const byId = new Map<string, { color: number }>();
      for (const ua of ex.atomsMatching('all')) byId.set(`${ua.objName}|${ua.atom.id}`, ua.atom);
      for (const [objName, id, color] of snap) {
        if (wanted && !wanted.has(Number(color))) continue;
        const a = byId.get(`${objName}|${id}`);
        if (a) a.color = Number(color);
      }
      ctx.publish();
    };

    if (Array.isArray(first) && first.length > 0 && !Array.isArray(first[0])) {
      // Native flat colorection: recolour only atoms whose snapshot colour is
      // named by an even-index entry of the pair list.
      const flat = first as number[];
      const wanted = new Set<number>();
      for (let i = 0; i < flat.length; i += 2) wanted.add(Number(flat[i]));
      const snap = COLORECTIONS.get(prefixOf(args, str));
      if (!snap) return null;
      applySnapshot(snap, wanted);
      return null;
    }

    const snap: ColorSnapshot | undefined = Array.isArray(first)
      ? (first as ColorSnapshot)
      : COLORECTIONS.get(prefixOf(args, str));
    if (!snap) return null;
    applySnapshot(snap);
    return null;
  });

  // del_colorection(prefix): drop the stored snapshot.
  ctx.command('del_colorection', (args): Json => {
    COLORECTIONS.delete(prefixOf(args, str));
    return null;
  });
}
