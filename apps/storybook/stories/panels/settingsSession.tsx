/**
 * A per-story session whose `conn` carries the topic-subscription surface the
 * settings service reaches for the moment it is constructed.
 *
 * `getSettingsService(session)` (the module that both {@link SettingsPanel} and
 * {@link LightingPanel}'s store come from) subscribes on creation:
 * `session.conn.on('settings', …)`, `session.conn.sub('settings')`, and it reads
 * `session.conn.do` / `.isOpen` plus `session.poller.kick`. The base stub `conn`
 * has none of those, so the panels crash with "session.conn.on is not a
 * function". This decorator supplies inert versions — `on` returns an
 * unsubscribe, `sub`/`do` resolve, `kick` no-ops — so the service builds and the
 * panels render their genuine, catalogue-less state. Nothing here reaches a
 * bridge; the engine simply holds nothing.
 *
 * Not a `*.stories.tsx` file, so Storybook does not index it as a story.
 */

import type { Decorator } from '@storybook/react-vite';
import type {
  SettingCatalogue,
  SettingKind,
  SettingLevel,
  SettingMeta,
  SettingValue,
  SettingValueRow,
} from '@tenmol/protocol';
import { scopesForLevel } from '@tenmol/stores/settings';
import { SessionContext, type Session } from '@web/app';
import { getSettingsService } from '@web/features/settings/service';
import catalogueFixture from '@web/features/settings/__fixtures__/catalogue.json';

import { mockSession } from '../../.storybook/decorators';

/** Wrap a story in a session whose `conn` answers the settings-service seams. */
export const withSettingsData: Decorator = (Story) => {
  const base = mockSession();
  const session: Session = {
    ...base,
    conn: {
      ...base.conn,
      isOpen: true,
      on: () => () => undefined,
      sub: () => Promise.resolve(),
      do: () => Promise.resolve(null),
    },
    poller: { ...base.poller, kick: () => undefined },
  } as unknown as Session;
  return (
    <SessionContext.Provider value={session}>
      <Story />
    </SessionContext.Provider>
  );
};

/* ------------------------------------------------------------------ *
 * A SEEDED settings service — the catalogue an idle engine never sends.
 *
 * `withSettingsData` supplies the conn seams the service reaches for, but the
 * store then sits at `phase: 'idle'` with a null catalogue, so every window it
 * opens reads "loading the setting catalogue…". Storybook has no bridge to
 * answer `setting.tenmol_settings_catalogue`, so this decorator hands the store
 * the same shape that call would: the 779-row catalogue harvested into
 * `__fixtures__/catalogue.json` (names + levels + kinds — the real table), plus
 * a spread of values so the Advanced table's cells and the Setting menu's check
 * marks render populated instead of blank. Nothing here reaches a bridge.
 * ------------------------------------------------------------------ */

/** The harvested catalogue as JSON: parallel name / level / kind maps. */
const FIXTURE = catalogueFixture as {
  count: number;
  names: string[];
  levels: Record<string, SettingLevel>;
  kinds: Record<string, SettingKind>;
};

/** A handful of colour names `cmd.get` renders a colour-index setting as. */
const COLOR_NAMES = ['black', 'white', 'grey80', 'marine', 'orange', 'yellow', 'forest'];

/** A plausible per-kind value + text pair, keyed off the row index for spread. */
function seedValue(kind: SettingKind, index: number): readonly [SettingValue, string] {
  switch (kind) {
    case 'boolean': {
      const on = index % 3 === 0 ? 1 : 0;
      return [on, on ? 'on' : 'off'];
    }
    case 'int': {
      const n = (index % 9) + 1;
      return [n, String(n)];
    }
    case 'float': {
      const n = ((index % 20) + 1) / 20;
      return [n, n.toFixed(5)];
    }
    case 'float3': {
      const r = ((index % 10) / 10).toFixed(5);
      const g = (((index + 3) % 10) / 10).toFixed(5);
      const b = (((index + 6) % 10) / 10).toFixed(5);
      return [[Number(r), Number(g), Number(b)], `[ ${r}, ${g}, ${b} ]`];
    }
    case 'color': {
      const name = COLOR_NAMES[index % COLOR_NAMES.length] as string;
      return [index % 40, name];
    }
    case 'string':
      return ['', ''];
    default:
      return [0, ''];
  }
}

/** A plausible default per kind — so the Default column and reset gate read true. */
function seedDefault(kind: SettingKind): SettingValue | undefined {
  switch (kind) {
    case 'boolean':
      return 0;
    case 'int':
      return 0;
    case 'float':
      return 1;
    case 'color':
      return -1;
    default:
      return undefined;
  }
}

/** Build the full {@link SettingCatalogue} the store applies, from the fixture. */
function seededCatalogue(): { catalogue: SettingCatalogue; values: SettingValueRow[] } {
  const settings: SettingMeta[] = FIXTURE.names.map((name, index) => {
    const kind = FIXTURE.kinds[name] as SettingKind;
    const level = FIXTURE.levels[name] as SettingLevel;
    const fallback = seedDefault(kind);
    return {
      index,
      name,
      kind,
      level,
      scopes: scopesForLevel(level),
      ...(fallback === undefined ? {} : { default: fallback }),
    };
  });
  const values: SettingValueRow[] = settings.map((meta) => {
    const [value, text] = seedValue(meta.kind, meta.index);
    return [meta.index, value, text] as const;
  });
  const catalogue: SettingCatalogue = {
    version: 1,
    count: settings.length,
    settings,
    aliases: {},
    counts: {},
    levelCounts: {},
    meta: {
      cSettingInit: 798,
      indexDictSize: settings.length + 1,
      nameListSize: settings.length,
      defaultsSource: 'packages/engine/layer1/SettingInfo.h',
      defaultsNote: '',
      minMaxEnforced: false,
      minMaxNote: 'ranges are hints — PyMOL clamps only global int writes',
      helpSource: 'packages/engine/data/setting_help.csv',
      helpRows: 697,
    },
  };
  return { catalogue, values };
}

/** A few molecule objects, so the Advanced table's per-object scope has targets. */
const OBJECT_NAMES = ['1ubq', 'ao_ligand', 'benzene', 'surface_map'];

/**
 * Wrap a story in a session whose settings store is already `ready` and holds a
 * realistic 779-row catalogue with values — the populated state the Setting
 * menu, the Advanced table and the phase pill were built to show.
 */
export const withSettingsCatalogue: Decorator = (Story) => {
  const base = mockSession();
  const session: Session = {
    ...base,
    conn: {
      ...base.conn,
      isOpen: true,
      on: () => () => undefined,
      sub: () => Promise.resolve(),
      do: () => Promise.resolve(null),
    },
    poller: { ...base.poller, kick: () => undefined },
  } as unknown as Session;

  // A couple of molecule rows so the per-object scope selector is not empty.
  session.stores.objects.applyRows(
    OBJECT_NAMES.map((name) => ({
      name,
      type: 'object:molecule' as const,
      enabled: true,
      group: '',
      nest: 0,
      reps: 1,
      color: null,
      caption: '',
      states: 1,
      isGroup: false,
      cloaked: false,
      isAll: false,
      atoms: null,
      nestInferred: false,
    })),
    'topic',
  );

  // Seed the per-session settings store the panel will read on first render.
  const { store } = getSettingsService(session);
  const { catalogue, values } = seededCatalogue();
  store.applyCatalogue(catalogue);
  store.applyValues({ object: '', state: 0, values, failed: [] });
  store.setPhase('ready');

  return (
    <SessionContext.Provider value={session}>
      <Story />
    </SessionContext.Provider>
  );
};
