/**
 * A per-story session that seeds the Scenes panel with a realistic, POPULATED
 * scene bin and named-view list, so the panel renders like a working session
 * instead of the empty shell {@link withPanelData} produces.
 *
 * The panel bootstraps by reading a handful of aggregate + setting endpoints the
 * moment it mounts (`cmd.get_scene_panel`, `cmd.get_scene_thumbnail_png`,
 * `cmd.get_setting_boolean('scene_buttons')`, the two layout ints and
 * `cmd.get_viewport`); {@link useScenes} also runs the silent `cmd.do` bootstrap
 * + `cmd.get_movie_status` probe before it will trust `get_scene_panel`. This
 * decorator answers all of them with a fixed, believable snapshot — four stored
 * scenes with messages, store masks and PNG thumbnails, one of them current —
 * and rejects the named-view probe with the exact "unknown view … Choices:"
 * listing {@link parseViewNames} reads, so the Views strip lists real cameras.
 *
 * Not a `*.stories.tsx` file, so Storybook does not index it as a story.
 */

import type { Decorator } from '@storybook/react-vite';
import { SessionContext, type Session } from '@web/app';

import { mockSession } from '../../.storybook/decorators';
import { SCENE_THUMBS } from './sceneThumbs';

interface SeedScene {
  name: string;
  message: string;
  stores: string[];
  thumb: string;
}

/** The stored scenes this story shows — order matches the strip. */
const SEED: SeedScene[] = [
  { name: 'overview', message: 'Full assembly, cartoon', stores: ['view', 'color', 'rep'], thumb: SCENE_THUMBS.a },
  { name: 'active-site', message: 'Catalytic triad, sticks', stores: ['view', 'color', 'rep', 'active'], thumb: SCENE_THUMBS.b },
  { name: 'surface', message: 'Electrostatic surface', stores: ['view', 'color', 'rep'], thumb: SCENE_THUMBS.c },
  { name: 'ligand', message: 'Bound inhibitor closeup', stores: ['view', 'rep'], thumb: SCENE_THUMBS.d },
];

const CURRENT = 'active-site';

/** The camera views the Views strip lists (sorted, as the engine returns them). */
const VIEW_NAMES = ['front', 'top', 'active_site', 'ligand_pocket'];

const SCENE_PANEL = {
  order: SEED.map((s) => s.name),
  current: CURRENT,
  scenes: SEED.map((s) => ({
    name: s.name,
    message: s.message,
    storemask: 0,
    stores: s.stores,
    current: s.name === CURRENT,
  })),
};

/** Answer one bridge `cmd.*` / `menu.*` call with seeded scene data. */
function seededCall(fn: string, args?: readonly unknown[]): unknown {
  switch (fn) {
    case 'cmd.do':
      return null;
    case 'cmd.get_movie_status':
      return { frame: 1, state: 1, nframes: 0, length: 0, playing: false, locked: false, rocking: false, fps: null, sceneCurrent: CURRENT, settings: {} };
    case 'cmd.get_scene_panel':
      return SCENE_PANEL;
    case 'cmd.get_scene_list':
      return SCENE_PANEL.order;
    case 'cmd.get_scene_thumbnail_png': {
      const name = String(args?.[0] ?? '');
      const seed = SEED.find((s) => s.name === name);
      if (!seed) return null;
      return { name, encoding: 'png', width: 110, height: 62, bytes: 0, ready: true, data: seed.thumb };
    }
    case 'cmd.get_setting_boolean':
      return args?.[0] === 'scene_buttons' ? true : false;
    case 'cmd.get_setting_int':
      if (args?.[0] === 'internal_gui_control_size') return 18;
      if (args?.[0] === 'display_scale_factor') return 1;
      return 0;
    case 'cmd.get_viewport':
      return [232, 150];
    case 'menu.scene_menu':
      return [
        ['menu', 'Recall', [['cmd', `scene ${args?.[1]}, recall`, 'recall']]],
        ['menu', 'Store', [['cmd', `scene ${args?.[1]}, store`, 'store']]],
        ['sep', '', []],
        ['cmd', `scene ${args?.[1]}, clear`, 'Delete'],
      ];
    default:
      return null;
  }
}

/** Wrap a story in a session pre-loaded with four scenes and four named views. */
export const withScenesData: Decorator = (Story) => {
  const base = mockSession();
  const session: Session = {
    ...base,
    call: ((fn: string, args?: readonly unknown[]) =>
      Promise.resolve(seededCall(fn, args))) as Session['call'],
    conn: {
      ...base.conn,
      // `useViews` reads the named-view list out of the MESSAGE of a
      // deliberately failing `cmd.view` probe (there is no getter). Reject with
      // the "unknown view … Choices:" listing so `parseViewNames` returns the
      // four camera names above.
      call: () =>
        Promise.reject(
          new Error(
            `unknown view: '__tenmol_view_probe__'. Choices:\n  ${VIEW_NAMES.join('  ')}  `,
          ),
        ),
    },
  } as Session;
  return (
    <SessionContext.Provider value={session}>
      <Story />
    </SessionContext.Provider>
  );
};
