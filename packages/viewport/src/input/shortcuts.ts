/**
 * PyMOL's default key bindings — mirrored from
 * `modules/pymol/shortcut_dict.py:10-136`.
 *
 * WHY SHIPPED AS DATA. The runtime path is always the backend: a keystroke is
 * forwarded as `_button(k, -1|-2, 0, 0, mod)` and `cmd._ctrl`/`_alt`/`_ctsh`/
 * `_special` look the binding up in `cmd.key_mappings`
 * (`modules/pymol/internal.py:426-511`). Nothing here is ever executed by the
 * client. This table exists so the shortcut EDITOR has something to render —
 * `cmd.key_mappings` and `cmd.shortcut_dict` are plain dicts, and the bridge
 * dispatcher only resolves CALLABLES (`bridge/tenmol_bridge/dispatch.py:276`),
 * so there is no read path for them today. Writes DO go to Python, through
 * `cmd.set_key`, so validation and the mapping itself stay server-side.
 *
 * `p8a34keys.test.ts` diffs all 125 rows of this table — key, command and
 * description — against `pymol.shortcut_dict.shortcut_dict_ref` read out of a
 * LIVE engine (`__fixtures__/p8a34-keys.json`, regenerated and re-checked by
 * `bridge/tests/test_p8_a34.py`), so it cannot drift. An earlier version of
 * this comment named a `shortcuts.test.ts` that was never written.
 *
 * Bare `F1`..`F12` and `SHFT-F1`..`SHFT-F12` are deliberately absent: upstream
 * does not bind them, and `_special` falls through to scene- and view-name
 * lookup with prefix auto-completion (`internal.py:466-478`) — which is exactly
 * how `CTRL-Fn` = `scene Fn, store` is recalled.
 */

export interface DefaultShortcut {
  /** PyMOL notation: `CTRL-A`, `ALT-3`, `CTSH-pgup`, `left`. */
  key: string;
  /** The command string `cmd.do` runs, or a `cmd.*`/`editor.*` call. */
  command: string;
  /** Upstream's own one-line description; often empty. */
  description: string;
}

export const DEFAULT_SHORTCUTS: readonly DefaultShortcut[] = [
  { key: 'left', command: '_ backward', description: 'previous movie frame' },
  { key: 'right', command: '_ forward', description: 'next movie frame' },
  { key: 'pgup', command: 'scene action=previous', description: 'previous scene' },
  { key: 'pgdn', command: 'scene action=next', description: 'last scene' },
  { key: 'home', command: 'zoom animate=-1', description: 'zoom all' },
  { key: 'end', command: 'mtoggle', description: 'play/pause movie' },
  { key: 'insert', command: 'rock', description: '' },
  { key: 'SHFT-left', command: 'backward', description: '' },
  { key: 'SHFT-right', command: 'forward', description: '' },
  { key: 'SHFT-pgup', command: 'scene action=previous', description: 'previous scene' },
  { key: 'SHFT-pgdn', command: 'scene action=next', description: 'next scene' },
  { key: 'SHFT-home', command: 'rewind', description: '' },
  { key: 'SHFT-end', command: 'ending', description: '' },
  { key: 'SHFT-insert', command: 'rock', description: '' },
  { key: 'CTRL-left', command: 'backward', description: '' },
  { key: 'CTRL-right', command: 'forward', description: '' },
  { key: 'CTRL-pgup', command: '_ scene new, insert_before', description: 'insert scene before current' },
  { key: 'CTRL-pgdn', command: '_ scene new, insert_after', description: 'insert scene after current' },
  { key: 'CTRL-home', command: 'zoom animate=-1', description: 'zoom all' },
  { key: 'CTRL-end', command: 'scene new, store', description: 'store new scene' },
  { key: 'CTRL-insert', command: 'scene auto, store', description: 'store auto scene' },
  { key: 'CTRL-A', command: 'select sele, all, 1', description: 'select all' },
  { key: 'CTRL-C', command: 'editing_ring copy', description: 'copy' },
  { key: 'CTRL-F', command: 'wizard find', description: 'find' },
  { key: 'CTRL-H', command: 'help edit_keys', description: 'help' },
  { key: 'CTRL-I', command: 'editing_ring invert', description: 'invert selection' },
  { key: 'CTRL-L', command: 'util.ligand_zoom()', description: 'zoom next ligand' },
  { key: 'CTRL-T', command: 'bond;unpick', description: 'create bond' },
  { key: 'CTRL-V', command: 'editing_ring paste', description: 'paste' },
  { key: 'CTRL-X', command: 'editing_ring cut', description: 'cut' },
  { key: 'CTRL-Y', command: 'redo', description: '' },
  { key: 'CTRL-Z', command: 'undo', description: '' },
  { key: 'ALT-left', command: 'backward', description: '' },
  { key: 'ALT-right', command: 'forward', description: '' },
  { key: 'ALT-pgup', command: 'rewind', description: '' },
  { key: 'ALT-pgdn', command: 'ending', description: '' },
  { key: 'ALT-home', command: 'zoom animate=-1', description: 'zoom all' },
  { key: 'ALT-end', command: 'ending', description: '' },
  { key: 'ALT-insert', command: 'rock', description: '' },
  { key: 'ALT-1', command: 'editor.attach_fragment(\'pk1\', \'formamide\', 5, 0)', description: 'attach amide N->C' },
  { key: 'ALT-2', command: 'editor.attach_fragment(\'pk1\', \'formamide\', 4, 0)', description: 'attach amide C->N' },
  { key: 'ALT-3', command: 'editor.attach_fragment(\'pk1\', \'sulfone\', 3, 1)', description: 'attach sulfone' },
  { key: 'ALT-4', command: 'editor.attach_fragment(\'pk1\', \'cyclobutane\', 4, 0)', description: 'attach cyclobutane' },
  { key: 'ALT-5', command: 'editor.attach_fragment(\'pk1\', \'cyclopentane\', 5, 0)', description: 'attach cyclopentane' },
  { key: 'ALT-6', command: 'editor.attach_fragment(\'pk1\', \'cyclohexane\', 7, 0)', description: 'attach cyclohexane' },
  { key: 'ALT-7', command: 'editor.attach_fragment(\'pk1\', \'cycloheptane\', 8, 0)', description: 'attach cycloheptane' },
  { key: 'ALT-8', command: 'editor.attach_fragment(\'pk1\', \'cyclopentadiene\', 5, 0)', description: 'attach cyclopentadiene' },
  { key: 'ALT-9', command: 'editor.attach_fragment(\'pk1\', \'benzene\', 6, 0)', description: 'attach benzene' },
  { key: 'ALT-0', command: 'editor.attach_fragment(\'pk1\', \'formaldehyde\', 2, 0)', description: 'attach formaldehyde' },
  { key: 'ALT-A', command: 'editor.attach_amino_acid(\'pk1\', \'ala\')', description: 'attach ala' },
  { key: 'ALT-B', command: 'editor.attach_amino_acid(\'pk1\', \'ace\')', description: 'attach ace' },
  { key: 'ALT-C', command: 'editor.attach_amino_acid(\'pk1\', \'cys\')', description: 'attach cys' },
  { key: 'ALT-D', command: 'editor.attach_amino_acid(\'pk1\', \'asp\')', description: 'attach asp' },
  { key: 'ALT-E', command: 'editor.attach_amino_acid(\'pk1\', \'glu\')', description: 'attach glu' },
  { key: 'ALT-F', command: 'editor.attach_amino_acid(\'pk1\', \'phe\')', description: 'attach phe' },
  { key: 'ALT-G', command: 'editor.attach_amino_acid(\'pk1\', \'gly\')', description: 'attach gly' },
  { key: 'ALT-H', command: 'editor.attach_amino_acid(\'pk1\', \'his\')', description: 'attach his' },
  { key: 'ALT-I', command: 'editor.attach_amino_acid(\'pk1\', \'ile\')', description: 'attach ile' },
  { key: 'ALT-J', command: 'editor.attach_fragment(\'pk1\', \'acetylene\', 2, 0)', description: 'attach acetylene' },
  { key: 'ALT-K', command: 'editor.attach_amino_acid(\'pk1\', \'lys\')', description: 'attach lys' },
  { key: 'ALT-L', command: 'editor.attach_amino_acid(\'pk1\', \'leu\')', description: 'attach leu' },
  { key: 'ALT-M', command: 'editor.attach_amino_acid(\'pk1\', \'met\')', description: 'attach met' },
  { key: 'ALT-N', command: 'editor.attach_amino_acid(\'pk1\', \'asn\')', description: 'attach asn' },
  { key: 'ALT-P', command: 'editor.attach_amino_acid(\'pk1\', \'pro\')', description: 'attach pro' },
  { key: 'ALT-Q', command: 'editor.attach_amino_acid(\'pk1\', \'gln\')', description: 'attach gln' },
  { key: 'ALT-R', command: 'editor.attach_amino_acid(\'pk1\', \'arg\')', description: 'attach arg' },
  { key: 'ALT-S', command: 'editor.attach_amino_acid(\'pk1\', \'ser\')', description: 'attach ser' },
  { key: 'ALT-T', command: 'editor.attach_amino_acid(\'pk1\', \'thr\')', description: 'attach thr' },
  { key: 'ALT-V', command: 'editor.attach_amino_acid(\'pk1\', \'val\')', description: 'attach val' },
  { key: 'ALT-W', command: 'editor.attach_amino_acid(\'pk1\', \'trp\')', description: 'attach trp' },
  { key: 'ALT-Y', command: 'editor.attach_amino_acid(\'pk1\', \'tyr\')', description: 'attach tyr' },
  { key: 'ALT-Z', command: 'editor.attach_amino_acid(\'pk1\', \'nme\')', description: 'attach nme' },
  { key: 'CTSH-left', command: 'backward', description: '' },
  { key: 'CTSH-right', command: 'forward', description: '' },
  { key: 'CTSH-pgup', command: 'scene new, insert_before', description: 'insert scene before current' },
  { key: 'CTSH-pgdn', command: 'scene new, insert_after', description: 'insert scene after current' },
  { key: 'CTSH-home', command: 'zoom animate=-1', description: 'zoom all' },
  { key: 'CTSH-end', command: 'mtoggle', description: '' },
  { key: 'CTSH-insert', command: 'rock', description: '' },
  { key: 'CTSH-A', command: 'redo', description: '' },
  { key: 'CTSH-B', command: 'replace Br,1,1', description: '' },
  { key: 'CTSH-C', command: 'replace C,4,4', description: '' },
  { key: 'CTSH-D', command: 'remove_picked', description: '' },
  { key: 'CTSH-E', command: 'invert', description: '' },
  { key: 'CTSH-F', command: 'replace F,1,1', description: '' },
  { key: 'CTSH-G', command: 'replace H,1,1', description: '' },
  { key: 'CTSH-I', command: 'replace I,1,1', description: '' },
  { key: 'CTSH-J', command: 'alter pk1,formal_charge=-1.', description: '' },
  { key: 'CTSH-K', command: 'alter pk1,formal_charge=1.', description: '' },
  { key: 'CTSH-L', command: 'replace Cl,1,1', description: '' },
  { key: 'CTSH-N', command: 'replace N,4,3', description: '' },
  { key: 'CTSH-O', command: 'replace O,4,2', description: '' },
  { key: 'CTSH-P', command: 'replace P,4,1', description: '' },
  { key: 'CTSH-R', command: 'h_fill', description: '' },
  { key: 'CTSH-S', command: 'replace S,4,2', description: '' },
  { key: 'CTSH-T', command: 'bond;unpick', description: '' },
  { key: 'CTSH-U', command: 'alter pk1,formal_charge=0.', description: '' },
  { key: 'CTSH-W', command: 'cycle_valence', description: '' },
  { key: 'CTSH-X', command: 'cmd.auto_measure()', description: 'auto measure' },
  { key: 'CTSH-Y', command: 'attach H,1,1', description: '' },
  { key: 'CTSH-Z', command: 'undo', description: '' },
  { key: 'CTRL-F1', command: 'scene F1, store', description: '' },
  { key: 'CTSH-F1', command: 'scene SHFT-F1, store', description: '' },
  { key: 'CTRL-F2', command: 'scene F2, store', description: '' },
  { key: 'CTSH-F2', command: 'scene SHFT-F2, store', description: '' },
  { key: 'CTRL-F3', command: 'scene F3, store', description: '' },
  { key: 'CTSH-F3', command: 'scene SHFT-F3, store', description: '' },
  { key: 'CTRL-F4', command: 'scene F4, store', description: '' },
  { key: 'CTSH-F4', command: 'scene SHFT-F4, store', description: '' },
  { key: 'CTRL-F5', command: 'scene F5, store', description: '' },
  { key: 'CTSH-F5', command: 'scene SHFT-F5, store', description: '' },
  { key: 'CTRL-F6', command: 'scene F6, store', description: '' },
  { key: 'CTSH-F6', command: 'scene SHFT-F6, store', description: '' },
  { key: 'CTRL-F7', command: 'scene F7, store', description: '' },
  { key: 'CTSH-F7', command: 'scene SHFT-F7, store', description: '' },
  { key: 'CTRL-F8', command: 'scene F8, store', description: '' },
  { key: 'CTSH-F8', command: 'scene SHFT-F8, store', description: '' },
  { key: 'CTRL-F9', command: 'scene F9, store', description: '' },
  { key: 'CTSH-F9', command: 'scene SHFT-F9, store', description: '' },
  { key: 'CTRL-F10', command: 'scene F10, store', description: '' },
  { key: 'CTSH-F10', command: 'scene SHFT-F10, store', description: '' },
  { key: 'CTRL-F11', command: 'scene F11, store', description: '' },
  { key: 'CTSH-F11', command: 'scene SHFT-F11, store', description: '' },
  { key: 'CTRL-F12', command: 'scene F12, store', description: '' },
  { key: 'CTSH-F12', command: 'scene SHFT-F12, store', description: '' },
];

/** Index by key, for the editor's lookup and for "is this the default?". */
export const DEFAULT_SHORTCUT_BY_KEY: ReadonlyMap<string, DefaultShortcut> = new Map(
  DEFAULT_SHORTCUTS.map((entry) => [entry.key, entry]),
);

/**
 * The five groups the editor and `docs/webclient/input-mouse-keyboard.md §15.4`
 * use to organise the table.
 */
export function shortcutGroup(key: string): string {
  const bare = key.includes('-') ? key.slice(key.indexOf('-') + 1) : key;
  if (/^F([1-9]|1[0-2])$/.test(bare)) return 'function keys';
  if (/^[0-9]$/.test(bare)) return 'fragment attach';
  if (/^[A-Z]$/.test(bare)) {
    if (key.startsWith('ALT-')) return 'amino-acid attach';
    if (key.startsWith('CTSH-')) return 'chemical editing';
    return 'editing';
  }
  return 'navigation / movie / scene';
}
