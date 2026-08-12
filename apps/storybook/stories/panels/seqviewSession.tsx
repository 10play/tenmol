/**
 * A per-story session that seeds the sequence viewer ("Seeker") with a real,
 * POPULATED window — two protein chains of one-letter residue codes, residue-
 * number labels, a chain breadcrumb, per-residue-class colouring and a live
 * selection run — so the strip renders like a working session instead of the
 * `visible: false` nothing the C block draws when no object has `seq_view` on.
 *
 * The component bootstraps and polls through a single dotted bridge entry point
 * (`features/seqview/source.ts`): a silent `cmd.do` import, an `['install']`
 * probe that must answer `{ installed: true }`, then `['rows', -1, first, count]`
 * for each poll pass. This decorator answers all three, flips the mock
 * connection to `open` (the poll only runs while the phase is `open`), and hands
 * back a fixed {@link SeqviewPayload} so the virtualised grid draws real cells,
 * labels and mini-map ticks.
 *
 * Not a `*.stories.tsx` file, so Storybook does not index it as a story.
 */

import type { Decorator } from '@storybook/react-vite';
import { SessionContext, type Session } from '@web/app';
import type {
  SeqviewCell,
  SeqviewLabel,
  SeqviewPayload,
  SeqviewRow,
} from '@tenmol/protocol/topics/seqview';

import { mockSession } from '../../.storybook/decorators';

/* ------------------------------------------------------------------ *
 * a residue-class colour scheme (muted, not a rainbow)
 * ------------------------------------------------------------------ */

/** Colour-index → 0..1 RGB, the shape `SeqviewPayload.colors` carries. */
const COLORS: Record<string, number[]> = {
  1: [0.85, 0.78, 0.56], // hydrophobic — warm sand
  2: [0.56, 0.83, 0.86], // polar — teal
  3: [0.56, 0.69, 0.97], // basic — indigo-blue
  4: [0.96, 0.63, 0.57], // acidic — soft red
  5: [0.74, 0.8, 0.72], // glycine / proline — sage
  104: [0.42, 0.46, 0.52], // seq_view_fill_color — grey dashes
};

/** Map a one-letter residue code to one of the palette indices above. */
function classOf(code: string): number {
  if ('AVLIMFWC'.includes(code)) return 1;
  if ('STNQYH'.includes(code)) return 2;
  if ('KR'.includes(code)) return 3;
  if ('DE'.includes(code)) return 4;
  return 5; // G, P and anything else
}

/** Full three-letter names, for the hover title the component builds. */
const RESN: Record<string, string> = {
  A: 'ALA', R: 'ARG', N: 'ASN', D: 'ASP', C: 'CYS', E: 'GLU', Q: 'GLN',
  G: 'GLY', H: 'HIS', I: 'ILE', L: 'LEU', K: 'LYS', M: 'MET', F: 'PHE',
  P: 'PRO', S: 'SER', T: 'THR', W: 'TRP', Y: 'TYR', V: 'VAL',
};

/**
 * Build one object's row from a one-letter sequence. Cells are contiguous
 * (offset advances by one per residue, as `codes == 0` draws them), a residue
 * number is labelled every ten columns, and the columns in `[selFrom, selTo)`
 * are flagged `selected` so the strip shows inverted-video cells and the mini-
 * map draws a run.
 */
function buildRow(
  object: string,
  chain: string,
  seq: string,
  sel?: readonly [number, number],
): SeqviewRow {
  const cells: SeqviewCell[] = [];
  const labels: SeqviewLabel[] = [];
  for (let i = 0; i < seq.length; i += 1) {
    const code = seq[i]!;
    const resi = String(i + 1);
    const selected = sel ? i >= sel[0] && i < sel[1] : false;
    cells.push({
      text: code,
      color: classOf(code),
      offset: i,
      atoms: [i * 8 + 1, i * 8 + 2, i * 8 + 3],
      isAbbr: true,
      selected,
      resi,
      chain,
      resn: RESN[code] ?? code,
    });
    // A residue number every tenth column (10, 20, 30 …); the leading chain
    // breadcrumb stands in for the residue-1 label so the two never collide.
    if ((i + 1) % 10 === 0) labels.push({ col: i, offset: i, text: resi });
  }
  return {
    object,
    objectColor: -1,
    codes: 0,
    selectable: true,
    discrete: false,
    extLen: seq.length,
    nCols: seq.length,
    first: 0,
    truncated: false,
    cells,
    fill: [],
    labels,
    breadcrumbs: [{ col: 0, offset: 0, text: `${chain}/` }],
  };
}

/** H-Ras (residues 1–76) — the P-loop `GAGGVGKS` is pre-selected. */
const RAS = 'MTEYKLVVVGAGGVGKSALTIQLIQNHFVDEYDPTIEDSYRKQVVIDGETCLLDILDTAGQEEYSAMRDQYMRTGEG';
/** A c-Raf RBD fragment (residues 56–101), a believable second chain. */
const RAF = 'PSKTSNTIRVFLPNKQRTVVNVRNGMSLHDCLMKALKVRGLQPECCAVFRLLHEHKGKKARLDWNT';

const ROWS: SeqviewRow[] = [
  buildRow('ras', 'A', RAS, [11, 17]),
  buildRow('raf', 'B', RAF),
];

/** The window a poll answers — the whole (short) sequence fits in one frame. */
const PAYLOAD: SeqviewPayload = {
  visible: true,
  location: 0,
  overlay: false,
  format: 0,
  labelMode: 2,
  gapMode: 1,
  fillColor: 104,
  activeSele: 'sele',
  seleMode: 'byresi',
  alignment: '',
  unalignedMode: 0,
  unalignedColor: 104,
  fillChar: '-',
  bgColor: [0.04, 0.05, 0.07],
  rows: ROWS,
  colors: COLORS,
  window: { first: 0, count: 1200, max: 1200 },
};

/** The dotted entry point the seqview source calls the bridge helper through. */
const ENTRY_POINT = 'cmd.tenmol_seqview';

/** Answer one bridge call with the seeded sequence window. */
function seededCall(fn: string, args?: readonly unknown[]): unknown {
  if (fn === ENTRY_POINT) {
    const verb = args?.[0];
    if (verb === 'install') return { installed: true };
    if (verb === 'rows') return PAYLOAD;
    // select / center / menu etc. — inert acknowledgements.
    return { name: 'sele', expression: '', log: '', count: 0, installed: true };
  }
  return null; // cmd.do and anything else
}

/**
 * Wrap a story in a session whose bridge answers the seqview poll with a
 * populated two-chain window, with the connection phase flipped to `open` so
 * the component's poll actually runs.
 */
export const withSeqviewData: Decorator = (Story) => {
  const base = mockSession();
  base.stores.connection.setPhase('open');
  const session: Session = {
    ...base,
    call: ((fn: string, args?: readonly unknown[]) =>
      Promise.resolve(seededCall(fn, args))) as Session['call'],
  } as Session;
  return (
    <SessionContext.Provider value={session}>
      <Story />
    </SessionContext.Provider>
  );
};
