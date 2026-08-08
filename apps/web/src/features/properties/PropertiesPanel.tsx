/**
 * The Properties Inspector — `packages/engine/modules/pmg_qt/properties_dialog.py` and the form
 * it loads, `packages/engine/modules/pmg_qt/forms/props.ui`.
 *
 * Header (`props.ui:20-77`, wired at `properties_dialog.py:119-145`): an Object
 * combo from `cmd.get_object_list()`, a State spin (1 .. count_states), an Atom
 * index spin (1 .. count_atoms) and a Refresh tool button. Changing any of the
 * three moves the pk1 pick with `cmd.edit`; Refresh re-reads the object list and
 * re-syncs from pk1.
 *
 * Body: the fixed four-level tree, whose shape lives in `model.ts` and whose
 * values come from `service.ts`.
 *
 * Editing: column 0 is never editable; column 1 dispatches by BRANCH, which is
 * the only thing that decides whether an edit is a `cmd.set`, a `cmd.alter` or a
 * `cmd.set_object_ttt`. Delete on the selected row unsets it. Both mirror
 * `item_changed` / `unset_item` call for call, and both reload the whole tree on
 * failure exactly as upstream does.
 *
 * The debounce on the header is not cosmetic: every keystroke in the index spin
 * would otherwise be a `cmd.edit` plus a full tree read over the socket.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { PropertyRow } from '@tenmol/protocol/topics/dialogs';
import { Checkbox, IconButton, Select, TextInput } from '../../ui';
import { useSession } from '../../app';
import { DialogWindow } from '../dialogs/DialogWindow';
import type { DialogWindowSpec } from '../dialogs/store';
import { useHostedWindows } from '../dialogs/useDialogs';
import { emptyTree, type PropertySection } from './model';
import {
  applyEdit,
  applyUnset,
  atomRows,
  atomSettingsPlaceholder,
  astateSettingsPlaceholder,
  counts,
  currentState,
  movePk1,
  objectList,
  objectRows,
  ostateRows,
  probePk1,
  readPk1,
  settingRows,
} from './service';
import './properties.css';

/**
 * How often the panel asks where pk1 is, in ms.
 *
 * There is nothing to subscribe to (see the effect below), so this number is a
 * trade: one `cmd.index('?pk1')` per tick against how stale the panel is after
 * a click in the viewport. 600 ms is under the ~1 s at which a UI stops feeling
 * connected to the click that caused it, and 1.7 calls/s is a rounding error
 * next to the 30 Hz pump.
 */
const PK1_POLL_MS = 600;

const FOLLOW_TITLE =
  'Re-read pk1 every 600 ms and follow picks made in the viewport. ' +
  'There is no pk1-changed event to subscribe to: the selection topic accepts ' +
  'a subscription and nothing publishes to it.';

export function PropertiesPanel({ spec }: { spec: DialogWindowSpec }) {
  const session = useSession();

  const [objects, setObjects] = useState<string[]>([]);
  const [model, setModel] = useState('');
  const [state, setState] = useState(1);
  const [index, setIndex] = useState(1);
  const [maxState, setMaxState] = useState(1);
  const [maxIndex, setMaxIndex] = useState(1);
  const [sections, setSections] = useState<PropertySection[]>(emptyTree);
  const [selected, setSelected] = useState<string>('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [follow, setFollow] = useState(true);

  /** `objects`, readable from the poll without making it an effect dependency. */
  const objectsRef = useRef<string[]>([]);
  objectsRef.current = objects;

  /** setting index -> name. `get_name_list()` is NOT index-ordered (779 names,
   *  higher indices), so the two public list getters are zipped instead:
   *  `setting.get_name_list()` and `setting.get_index_list()` both come from the
   *  same `index_dict` (`packages/engine/modules/pymol/setting.py:39-81`) and therefore agree
   *  positionally. */
  const settingNames = useRef<Map<number, string>>(new Map());

  /* ------------------------------------------------------------ bootstrap */

  const refreshObjects = useCallback(async () => {
    setError('');
    try {
      const [list, st] = await Promise.all([objectList(session), currentState(session)]);
      setObjects(list);
      setState((s) => (s === 1 ? st : s));
      const pk1 = await readPk1(session);
      if (pk1 && list.includes(pk1.model)) {
        setModel(pk1.model);
        setIndex(pk1.index);
      } else {
        setModel((m) => (m && list.includes(m) ? m : (list[0] ?? '')));
      }
    } catch (e: unknown) {
      setError(messageOf(e));
    }
  }, [session]);

  useEffect(() => {
    void refreshObjects();
    // `setting.name_dict` has no bridge getter; the name LIST does, and the
    // object-settings rows come back as numeric indices, so this is how a row
    // labelled `123` becomes `sphere_scale`.
    void Promise.all([
      session.call<string[]>('setting.get_name_list'),
      session.call<number[]>('setting.get_index_list'),
    ])
      .then(([names, indices]) => {
        const map = new Map<number, string>();
        if (Array.isArray(names) && Array.isArray(indices)) {
          for (let i = 0; i < Math.min(names.length, indices.length); i++) {
            map.set(indices[i]!, names[i]!);
          }
        }
        settingNames.current = map;
      })
      .catch(() => undefined);
  }, [refreshObjects, session]);

  /* ---------------------------------------------------------- tree reload */

  const reload = useCallback(async () => {
    if (!model) {
      setSections(emptyTree());
      return;
    }
    setBusy(true);
    setError('');
    try {
      const { atoms, states } = await counts(session, model);
      setMaxIndex(Math.max(1, atoms));
      setMaxState(Math.max(1, states));
      const boundedIndex = Math.min(Math.max(1, index), Math.max(1, atoms));
      const boundedState = Math.min(Math.max(1, state), Math.max(1, states));

      await movePk1(session, model, boundedIndex);

      const [objRows, objSettings, oRows, oSettings, atom] = await Promise.all([
        objectRows(session, model),
        settingRows(session, model, 0, 'object-settings'),
        ostateRows(session, model, boundedState),
        settingRows(session, model, boundedState, 'ostate-settings'),
        atomRows(session, model, boundedIndex, boundedState),
      ]);

      const tree = emptyTree();
      assign(tree, 'object-ttt', objRows);
      assign(tree, 'object-settings', named(objSettings, settingNames.current));
      assign(
        tree,
        'ostate-title',
        oRows.filter((r) => r.branch === 'ostate-title'),
      );
      assign(
        tree,
        'ostate-matrix',
        oRows.filter((r) => r.branch === 'ostate-matrix'),
      );
      assign(tree, 'ostate-settings', named(oSettings, settingNames.current));
      assign(tree, 'atom-identifiers', atom.identifiers);
      assign(tree, 'atom-builtins', atom.builtins);
      // Upstream marks this branch Incentive-only and hides it; `p.all` works
      // here, so the rows are real.
      assign(tree, 'atom-properties', atom.properties);
      assign(tree, 'atom-settings', atomSettingsPlaceholder());
      assign(tree, 'astate-builtins', atom.astate);
      assign(tree, 'astate-settings', astateSettingsPlaceholder());

      // `item_atom.setHidden(natoms == 0)` / `item_ostate.setHidden(nstates == 0)`
      // (`properties_dialog.py:395-397`).
      for (const section of tree) {
        if ((section.id === 'atom' || section.id === 'astate') && atoms === 0)
          section.hidden = true;
        if (section.id === 'ostate' && states === 0) section.hidden = true;
      }
      setSections(tree);
    } catch (e: unknown) {
      setError(messageOf(e));
    } finally {
      setBusy(false);
    }
  }, [session, model, state, index]);

  useEffect(() => {
    const timer = setTimeout(() => void reload(), 120);
    return () => clearTimeout(timer);
  }, [reload]);

  /* ------------------------------------------------------- follow the pick */

  /**
   * The panel follows viewport picks.
   *
   * The inventory row asks for "a pk1-changed event"; there is no such event
   * and there is no way to make one from here. The `selection` topic exists and
   * ACCEPTS a subscription — which is the trap, because a client can wire
   * itself up, see `subscribed: true` and wait forever — but nothing in
   * `packages/bridge/tenmol_bridge` ever publishes to it. Asserted, not assumed, in
   * `packages/bridge/tests/test_p8_a10.py`.
   *
   * So this is a poll, exactly as `features/scenes/useScenes.ts` stands in for
   * the scenes drain, and it costs ONE `cmd.index('?pk1')` per tick — the whole
   * pk1 answer in one round trip, against `readPk1`'s three. It runs only while
   * the panel is open and only while `follow` is on, and the checkbox exists
   * so that a poll the user does not want is a poll the user can stop.
   *
   * NO "did the panel write this itself?" GUARD, and that is deliberate.
   * `reload()` ends in `cmd.edit` (upstream's `update_pk1`), so every tick sees
   * a pk1 the panel set — but `setModel`/`setIndex` with the value already in
   * state is a React BAIL-OUT: no re-render, no reload, no traffic. A guard was
   * written here first and deleting it changed nothing measurable (the test
   * below passed either way), while it actively broke the one case where the
   * two disagree: `reload()` writes the index CLAMPED to `count_atoms`, and
   * without a guard the next tick pulls the header box back to the atom the
   * tree is actually showing. So the absence is load-bearing and the tests
   * below pin the traffic instead.
   *
   * Replace the body with a subscription the day something publishes.
   */
  useEffect(() => {
    if (!follow) return;
    let cancelled = false;
    const tick = async () => {
      try {
        const pk = await probePk1(session);
        if (cancelled || !pk) return;
        // Only when the pick names an object this panel has never listed: an
        // unconditional re-read would double the cost of every single tick.
        if (!objectsRef.current.includes(pk.model)) {
          // a pick in an object created since the panel opened
          const list = await objectList(session);
          if (cancelled) return;
          setObjects(list);
        }
        setModel(pk.model);
        setIndex(pk.index);
      } catch {
        // a closed socket must not turn into an error banner every 600 ms
      }
    };
    const timer = setInterval(() => void tick(), PK1_POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [session, follow]);

  /* ------------------------------------------------------------- editing */

  const commit = useCallback(
    async (row: PropertyRow, text: string) => {
      if (row.readOnly || row.unavailable) return;
      setError('');
      try {
        await applyEdit(session, { model, state }, row, text);
      } catch (e: unknown) {
        setError(messageOf(e));
      }
      // "any failure reloads the whole tree" — and so does success, because
      // PyMOL may coerce what it was given.
      void reload();
    },
    [session, model, state, reload],
  );

  const unset = useCallback(
    async (row: PropertyRow) => {
      setError('');
      try {
        if (await applyUnset(session, { model, state }, row)) void reload();
      } catch (e: unknown) {
        setError(messageOf(e));
      }
    },
    [session, model, state, reload],
  );

  /* -------------------------------------------------------------- render */

  return (
    <DialogWindow spec={spec}>
      <div
        className="props modern:bg-pm-panel modern:text-pm-text"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key !== 'Delete' && e.key !== 'Backspace') return;
          const row = findRow(sections, selected);
          if (!row) return;
          e.preventDefault();
          void unset(row);
        }}
      >
        <div className="props__head modern:text-pm-text-dim">
          <label>
            Object
            <Select data-props-model="" value={model} onChange={(e) => setModel(e.target.value)}>
              {objects.length === 0 && <option value="">(no objects)</option>}
              {objects.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </Select>
          </label>
          <label>
            State
            <TextInput
              type="number"
              data-props-state=""
              min={1}
              max={maxState}
              value={state}
              onChange={(e) => setState(clamp(Number(e.target.value), 1, maxState))}
            />
          </label>
          <label>
            Index
            <TextInput
              type="number"
              data-props-index=""
              min={1}
              max={maxIndex}
              value={index}
              onChange={(e) => setIndex(clamp(Number(e.target.value), 1, maxIndex))}
            />
          </label>
          <IconButton
            type="button"
            data-props-refresh=""
            title="Refresh — re-read the object list and re-sync from pk1"
            onClick={() => {
              void refreshObjects().then(() => reload());
            }}
          >
            ⟳
          </IconButton>
          <label className="props__follow" title={FOLLOW_TITLE}>
            <Checkbox
              data-props-follow=""
              checked={follow}
              onChange={(e) => setFollow(e.target.checked)}
            />
            follow pick
          </label>
          {busy && <span className="props__busy">…</span>}
        </div>

        {error && <div className="props__error modern:text-danger">{error}</div>}

        <div
          className="props__tree modern:rounded-md modern:border modern:border-line modern:bg-pm-panel-alt"
          data-props-tree=""
        >
          {sections
            .filter((s) => !s.hidden)
            .map((section) => (
              <div className="props__section" key={section.id}>
                <div className="props__section-label modern:text-pm-text-bright">
                  {section.label}
                </div>
                {section.groups.map((group) => (
                  <div className="props__group" key={group.id}>
                    <div className="props__group-label modern:text-pm-text-dim">{group.label}</div>
                    {group.rows.length === 0 && (
                      <div className="props__empty modern:text-pm-text-dim">—</div>
                    )}
                    {group.rows.map((row) => {
                      const id = `${group.id}/${row.key}`;
                      return (
                        <div
                          key={id}
                          className={
                            'props__row modern:rounded' +
                            (selected === id
                              ? ' is-selected modern:bg-accent-soft modern:text-pm-text-bright'
                              : '')
                          }
                          data-props-row={id}
                          onClick={() => setSelected(id)}
                        >
                          <span className="props__key" title={row.key}>
                            {row.key}
                          </span>
                          {row.unavailable ? (
                            <span className="props__unavailable" title={row.unavailable}>
                              unavailable
                            </span>
                          ) : row.readOnly ? (
                            <span className="props__ro modern:text-pm-text-dim">{row.text}</span>
                          ) : (
                            <TextInput
                              className="props__value"
                              data-props-value={id}
                              defaultValue={row.text}
                              key={row.text}
                              onBlur={(e) => {
                                if (e.target.value !== row.text) void commit(row, e.target.value);
                              }}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') e.currentTarget.blur();
                              }}
                            />
                          )}
                        </div>
                      );
                    })}
                  </div>
                ))}
              </div>
            ))}
        </div>
      </div>
    </DialogWindow>
  );
}

/** The kinds this slot hosts when the `dialogs` slot is not mounted. */
const HOSTS = ['properties'] as const;

/** Slot panel. */
export function PropertiesSlot() {
  const windows = useHostedWindows(HOSTS);
  return (
    <>
      {windows.map((w) => (
        <PropertiesPanel key={w.key} spec={w} />
      ))}
    </>
  );
}

/* ---------------------------------------------------------------- helpers */

function assign(tree: PropertySection[], groupId: string, rows: PropertyRow[]): void {
  for (const section of tree) {
    for (const group of section.groups) {
      if (group.id === groupId) group.rows = rows;
    }
  }
}

/** `name_dict.get(index, index)` (`properties_dialog.py:296`). */
function named(rows: PropertyRow[], names: Map<number, string>): PropertyRow[] {
  return rows.map((row) => {
    const name = names.get(Number(row.key));
    return name ? { ...row, key: name } : row;
  });
}

function findRow(sections: PropertySection[], id: string): PropertyRow | null {
  for (const section of sections) {
    for (const group of section.groups) {
      for (const row of group.rows) {
        if (`${group.id}/${row.key}` === id) return row;
      }
    }
  }
  return null;
}

function clamp(value: number, low: number, high: number): number {
  if (!Number.isFinite(value)) return low;
  return Math.min(Math.max(Math.round(value), low), high);
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
