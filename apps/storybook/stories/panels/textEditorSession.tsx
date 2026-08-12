/**
 * A per-story session that drives the {@link TextEditorPanel} the way a live
 * bridge with the WP-18 files service installed would, instead of the empty
 * browser-fallback buffer the bare stub draws.
 *
 * WHY THE PANEL IS HOLLOW ON THE STUB. On mount the editor probes the bridge for
 * `cmd.tenmol_files.read_text`; the global `withSession` decorator answers every
 * `call()` with `null`, which never throws, so the probe technically "succeeds"
 * yet every subsequent read returns an empty string — the window opens on a file
 * name with a BLANK editor surface and a `browser fs` badge. Nothing to look at,
 * no syntax colours, no path.
 *
 * WHAT THIS SUPPLIES. A bridge whose `read_text` returns real file contents, so
 * the editor opens POPULATED: the Default story loads a genuine `.pml` render
 * script (comments, commands, arguments, a `python … python end` block — every
 * token kind lit), reports the `bridge fs` badge, and enables Run. The Pymolrc
 * story additionally exercises the "restart to apply" note and the multi-file
 * chooser (`cmd.tenmol_files.pymolrc` returns two active rc files).
 *
 * Not a `*.stories.tsx` file, so Storybook does not index it as a story.
 */

import type { Decorator } from '@storybook/react-vite';
import { SessionContext, type Session } from '@web/app';

import { mockSession } from '../../.storybook/decorators';

/** `FILES_NS` from `@tenmol/protocol/topics/files` — inlined; the stories dir
 * cannot resolve the protocol package (only `@tenmol/stores` + the `@web` alias
 * are on its path). */
const FILES_NS = 'cmd.tenmol_files';

/** A representative PML render script — the Default editor opens on this. */
const DEMO_PML = `# demo.pml — figure render for ubiquitin (1UBQ)
# edit freely; Save writes back through the bridge filesystem.

reinitialize
load 1ubq.pdb, ubiquitin
bg_color white

hide everything
show cartoon, ubiquitin
show sticks, resn LYS+ARG and not name C+N+O

color slate, ss H
color salmon, ss S
color grey80, ss L+""
util.cnc resn LYS+ARG

set cartoon_transparency, 0.15
set ray_shadows, 0
set ambient, 0.35
set specular, 0.25

# render one frame per five degrees for the turntable movie
python
from pymol import cmd
for angle in range(0, 360, 5):
    cmd.turn("y", 5)
    cmd.png("frames/turn_%03d.png" % angle, width=1200, height=900, dpi=150)
python end

orient ubiquitin
ray 1600, 1200
png ubiquitin_figure.png, dpi=300
`;

/** A representative `~/.pymolrc` — the Pymolrc story opens on this. */
const DEMO_PYMOLRC = `# ~/.pymolrc — loaded once at startup
# defaults for every session on this machine.

set ray_trace_mode, 1
set ray_shadows, 0
set antialias, 2
set ambient_occlusion_mode, 1

bg_color white
set cartoon_fancy_helices, 1
set cartoon_highlight_color, grey60

set_color softblue, [0.40, 0.55, 0.85]
set_color warmgrey, [0.72, 0.70, 0.68]

# personal shortcuts
alias bw, set ray_trace_mode, 2
alias hq, set antialias, 4; set ray_shadows, 1
`;

/** The two active rc files `File ▸ Edit pymolrc` finds — drives the chooser. */
const PYMOLRC_PATHS = ['/home/ada/.pymolrc', '/home/ada/.pymolrc.pml'];

/** Answer one bridge call the way a host with the files service would. */
function textEditorCall(fn: string, args?: unknown[]): unknown {
  const a = args ?? [];
  if (fn === `${FILES_NS}.read_text`) {
    const path = String(a[0] ?? '');
    // The probe asks with an empty path: a live route that simply dislikes the
    // argument — enough to report `bridge fs`.
    if (path === '') return { ok: false, path: '', text: '', error: 'no path given' };
    if (path.endsWith('.pymolrc') || path.endsWith('.pymolrc.pml')) {
      return { ok: true, path, text: DEMO_PYMOLRC };
    }
    // Any other path resolves to the demo script, echoed at a real location.
    return { ok: true, path: '/home/ada/scripts/demo.pml', text: DEMO_PML };
  }
  if (fn === `${FILES_NS}.pymolrc`) {
    return { paths: PYMOLRC_PATHS, home: '/home/ada' };
  }
  if (fn === `${FILES_NS}.write_text`) return { ok: true };
  return null;
}

/** Wrap a story in a session that answers the text editor's file reads. */
export const withTextEditorData: Decorator = (Story) => {
  const base = mockSession();
  const session: Session = {
    ...base,
    call: ((fn: string, args?: unknown[]) =>
      Promise.resolve(textEditorCall(fn, args))) as Session['call'],
    conn: {
      ...base.conn,
      // `probeServerFiles` bootstraps the namespace with a `do` before it asks;
      // the first ask already succeeds here, but keep it inert so nothing throws.
      do: (() => Promise.resolve()) as unknown as Session['conn']['do'],
    },
    run: (() => Promise.resolve()) as Session['run'],
  } as Session;
  return (
    <SessionContext.Provider value={session}>
      <Story />
    </SessionContext.Provider>
  );
};
