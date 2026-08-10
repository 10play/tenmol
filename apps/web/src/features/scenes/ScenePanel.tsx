/**
 * Slot `scenes`, region `internal-gui`. Plan §6 WP-20.
 *
 * Two surfaces in one panel, because in PyMOL they are two surfaces over the
 * same list:
 *
 *  * the **scene buttons** overlay (`packages/engine/layer1/Scene.cpp:2885` `SceneDrawButtons`
 *    / `SceneClickButton`) — left click recalls on release over the same
 *    button, middle is "rapid browse" (recall on press and while dragging,
 *    `animate=0` with Ctrl), right opens `scene_menu` (`menu.py:1842`), and
 *    dragging reorders via `cmd.scene_order`. Current scene draws brighter
 *    than the rest (0.5 vs 0.25).
 *  * the **Scene Panel** dialog (`packages/engine/modules/pmg_qt/scene_bin_gui.py:29`) — Add
 *    Scene, name/preview columns, rename, Update, Delete, double-click to
 *    recall, drag handles to reorder. Its Message and Actions columns are
 *    hard-coded placeholders upstream; here Message is bound to the real
 *    `get_scene_message`/`set_scene_message`, which is what the inventory says
 *    it should have been.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { PanelMenuNode } from '@tenmol/protocol';
import type { SceneRecord } from '@tenmol/protocol/topics/movie';
import { useSession } from '../../app';
import { Button, TextInput } from '../../ui';
import { RowMenu } from '../objects/RowMenu';
import { useScenes } from './useScenes';
import { SceneMenu } from './SceneMenu';
import { ViewList } from './ViewList';
import { dragOrder, encodeMenu, renameProblem, reorder, sceneActions } from './sceneActions';
import { layoutSceneButtons } from './sceneButtonGeometry';
import './scenes.css';

/** The Scenes panel: the stored-scene buttons with rename, reorder and thumbnails. */
export function ScenePanel() {
  const session = useSession();
  const { payload, thumbs, run, loadThumb, refresh } = useScenes();
  const [selected, setSelected] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  /**
   * The strip's right-click popup: `pymol.menu.scene_menu`'s OWN entries.
   *
   * `items` is null until the call answers, so the popup renders its loading
   * state rather than a table this file made up.
   */
  const [menuFor, setMenuFor] = useState<{
    name: string;
    at: { x: number; y: number };
    items: readonly PanelMenuNode[] | null;
    error: string | null;
  } | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  /**
   * `CScene::Pressed` + `CScene::PressMode` for the button strip.
   *
   * A REF, not state, and that is load-bearing rather than a style choice.
   * These are plain fields on `CScene` and they are read by the very next
   * event: `mousedown` writes them and `mouseup` reads them. React state
   * updates are batched, so under any batching boundary — `act()` in a test, a
   * transition, two events delivered in one task — the release would read the
   * PREVIOUS value and the click would do nothing. Two existing tests dispatch
   * both events inside one `act()` and caught exactly that.
   *
   * `dragIndex` below is the render-visible half, set only while dragging.
   */
  const press = useRef<{ index: number; mode: 1 | 2 | 3 | 4 } | null>(null);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  /*
   * `scene_bin_gui.py:360-377` rejects a blank or space-containing name by
   * PRINTING to the console and silently reverting the cell. That is the one
   * behaviour the inventory row explicitly asks not to be cloned: the user
   * sees the name snap back with no reason given. The rejection is the same;
   * the reason is visible.
   */
  const [renameError, setRenameError] = useState<string | null>(null);
  /** Row index the pointer is currently over during a handle drag. */
  const [dropAt, setDropAt] = useState<number | null>(null);
  /**
   * `scene_buttons` (`_gui.py:801`, `packages/engine/layer1/Scene.cpp:2885`). Read from the
   * engine rather than kept locally: it is a global setting the Scene menu,
   * the settings table and any script can all write, and the overlay below is
   * exactly what it turns off.
   */
  const [buttons, setButtons] = useState<boolean | null>(null);
  /**
   * `internal_gui_control_size` and `display_scale_factor` — the two engine
   * numbers `SceneDrawButtons` lays the strip out with (`Scene.cpp:2896-2901`).
   * Read, not assumed: both are ordinary settings anything can write.
   */
  const [metrics, setMetrics] = useState({ controlSize: 18, scale: 1 });
  /**
   * `CScene::rect` — the block `SceneDrawButtons` lays the strip out in. It is
   * the SCENE's rect, i.e. the viewport, so it is read from the engine
   * (`cmd.get_viewport`) rather than measured off a CSS box: the numbers the
   * port needs are PyMOL's, not the DOM's.
   */
  const [block, setBlock] = useState<{ width: number; height: number } | null>(null);
  const [skip, setSkip] = useState(0);

  const readButtons = async () => {
    try {
      setButtons(await session.call<boolean>('cmd.get_setting_boolean', ['scene_buttons']));
    } catch {
      /* the panel works without it; leave the last known value */
    }
  };

  // Once, on mount: every write below re-reads it explicitly.
  useEffect(() => {
    void readButtons();
  }, []);

  useEffect(() => {
    void (async () => {
      try {
        const [controlSize, scale, viewport] = await Promise.all([
          session.call<number>('cmd.get_setting_int', ['internal_gui_control_size']),
          session.call<number>('cmd.get_setting_int', ['display_scale_factor']),
          session.call<[number, number]>('cmd.get_viewport'),
        ]);
        setMetrics({ controlSize: controlSize || 18, scale: scale || 1 });
        if (Array.isArray(viewport) && viewport.length === 2) {
          setBlock({ width: Number(viewport[0]), height: Number(viewport[1]) });
        }
      } catch {
        /* the defaults ARE PyMOL's defaults; a failed read changes nothing */
      }
    })();
  }, [session]);

  useEffect(() => {
    for (const scene of payload.scenes) {
      if (!thumbs[scene.name]) void loadThumb(scene.name);
    }
    // Re-request only for names we have not resolved yet.
  }, [payload.scenes, thumbs, loadThumb]);

  /**
   * `SceneDrawButtons`' layout for the current list. `null` until the engine
   * has answered `cmd.get_viewport` — see the strip below.
   */
  const layout = useMemo(() => {
    if (!block) return null;
    return layoutSceneButtons({
      rect: { left: 0, right: block.width, bottom: 0, top: block.height },
      controlSize: metrics.controlSize,
      scale: metrics.scale,
      names: payload.order,
      skip,
    });
  }, [block, metrics, payload.order, skip]);

  /** The window the layout drew: `NSkip` entries are scrolled past. */
  const visibleScenes = useMemo(() => {
    if (!layout?.shown) return payload.scenes;
    const drawn = new Set(layout.buttons.map((button) => button.name));
    return payload.scenes.filter((scene) => drawn.has(scene.name));
  }, [layout, payload.scenes]);

  const commitRename = async (scene: SceneRecord) => {
    // NOT trimmed before validating: " a b " is a name with spaces, and
    // trimming first would silently accept the interior space.
    const next = draft;
    const reason = renameProblem(next, scene.name, payload.order);
    if (reason !== null) {
      setRenameError(reason);
      return;
    }
    setRenaming(null);
    setRenameError(null);
    if (next !== scene.name) await run(sceneActions.rename(scene.name, next));
  };

  /**
   * Finish a handle drag. Issues ONE `scene_order` for the whole move.
   *
   * A release anywhere that is not a row cancels — see the effect below — so
   * dropping outside the list leaves the order untouched rather than sending
   * the last hovered position.
   */
  const commitDrag = (index: number) => {
    if (dragging === null) return;
    const name = dragging;
    setDragging(null);
    setDropAt(null);
    if (payload.order.indexOf(name) === index) return;
    void run(sceneActions.order(reorder(payload.order, name, index)));
  };

  /*
   * A strip press that ends anywhere but on a button.
   *
   * `SceneRelease` clears `Pressed`/`Over`/`PressMode` unconditionally — the
   * per-button branches only decide whether anything is EMITTED. Without this,
   * releasing off the strip left the machine armed and the next hover over a
   * button reordered the list with no button held down.
   */
  useEffect(() => {
    const clear = () => {
      press.current = null;
      setDragIndex(null);
    };
    window.addEventListener('mouseup', clear);
    return () => window.removeEventListener('mouseup', clear);
  }, []);

  useEffect(() => {
    if (dragging === null) return;
    const cancel = () => {
      setDragging(null);
      setDropAt(null);
    };
    // Fires after the row's own onPointerUp, which has already cleared
    // `dragging`; so this only runs when the release missed every row.
    window.addEventListener('pointerup', cancel);
    return () => window.removeEventListener('pointerup', cancel);
  }, [dragging]);

  /**
   * `MenuActivate1Arg(G, x, y + 20, ..., "scene_menu", name)`
   * (`SceneMouse.cpp:1119-1125`).
   *
   * The entries are fetched, not written here: `menu.scene_menu(None, name)`
   * over the ordinary call path. `self_cmd` is unused by that function
   * (`menu.py:1842-1849` only formats strings), which is why `null` is a legal
   * first argument — the same shape `features/volume` uses for
   * `menu.vol_color`.
   */
  const openSceneMenu = useCallback(
    (name: string, x: number, y: number) => {
      setMenuFor({ name, at: { x, y: y + 20 }, items: null, error: null });
      void session
        .call<unknown>('menu.scene_menu', [null, name])
        .then((raw) => {
          const items = encodeMenu(raw);
          setMenuFor((open) => (open && open.name === name ? { ...open, items } : open));
        })
        .catch((error: unknown) => {
          const text = error instanceof Error ? error.message : String(error);
          setMenuFor((open) =>
            open && open.name === name ? { ...open, items: [], error: text } : open,
          );
        });
    },
    [session],
  );

  /* ------------------------------------------------------------------ *
   * The strip's mouse machine — `SceneClickSceneButton` (`SceneMouse.cpp:178`),
   * `SceneDrag` (`:1233`) and `SceneRelease` (`:1076`).
   *
   * It is a four-state machine and the states are PyMOL's `PressMode`:
   *
   *   1  LEFT pressed      recall on RELEASE, and only over the same button
   *   2  MIDDLE pressed    "rapid browse": recall on the PRESS and again on
   *                        every button dragged over, Ctrl forcing animate=0
   *   3  RIGHT pressed     drag to reorder, or — released without moving —
   *                        `pymol.menu.scene_menu`
   *   4  dragging          reached from 3 only, one `scene_order` per row
   *                        crossed
   *
   * WHAT THIS REPLACES, and why it was wrong: the strip used to start a drag
   * on the LEFT button and open a hand-written rename/update/delete popup on
   * the right. Both buttons did the other one's job, and the popup was three
   * buttons this file invented rather than `menu.py:1842`.
   *
   * State 4 is reachable only from 3 because of a deliberate C fallthrough:
   * `case 2:` sets `I->Pressed = I->Over` before falling into `case 3:`, whose
   * test is `Pressed != Over` — false by construction. Middle-drag browses; it
   * never reorders.
   */
  const onButtonDown = (scene: SceneRecord, index: number, event: React.MouseEvent) => {
    if (event.button === 1) {
      event.preventDefault();
      press.current = { index, mode: 2 };
      // The press itself recalls, unless this scene is already current — the
      // `cur_name && elem.name != cur_name` guard at `SceneMouse.cpp:200-205`.
      if (scene.name !== payload.current) {
        void run(event.ctrlKey ? sceneActions.browse(scene.name) : sceneActions.recall(scene.name));
      }
      return;
    }
    if (event.button === 2) {
      event.preventDefault();
      press.current = { index, mode: 3 };
      return;
    }
    if (event.button === 0) press.current = { index, mode: 1 };
  };

  const onButtonEnter = (scene: SceneRecord, index: number, event: React.MouseEvent) => {
    const state = press.current;
    if (state === null || index === state.index) return;
    if (state.mode === 2) {
      if (scene.name !== payload.current) {
        void run(event.ctrlKey ? sceneActions.browse(scene.name) : sceneActions.recall(scene.name));
      }
      press.current = { index, mode: 2 };
      return;
    }
    if (state.mode === 3 || state.mode === 4) {
      const action = dragOrder(payload.order, state.index, index);
      if (action) void run(action);
      press.current = { index, mode: 4 };
      setDragIndex(index);
    }
  };

  const onButtonUp = (scene: SceneRecord, index: number, event: React.MouseEvent) => {
    const state = press.current;
    press.current = null;
    setDragIndex(null);
    if (state === null) return;
    if (state.mode === 1 && event.button === 0) {
      // `I->Over == I->Pressed` — a left press that wandered off recalls nothing.
      if (index !== state.index) return;
      setSelected(scene.name);
      void run(sceneActions.recall(scene.name));
      return;
    }
    if (state.mode === 2 && event.button === 1) {
      if (scene.name !== payload.current) void run(sceneActions.recall(scene.name));
      return;
    }
    if (state.mode === 3 && event.button === 2) {
      // No drag happened, so this is the menu, at the press point + 20 px the
      // way `MenuActivate1Arg(G, x, y + 20, ...)` offsets it.
      openSceneMenu(scene.name, event.clientX, event.clientY);
    }
  };

  return (
    <div className="scpanel modern:bg-pm-panel modern:text-pm-text">
      <div className="scpanel__head modern:bg-pm-panel-alt modern:text-pm-text-dim modern:border-line">
        <span className="scpanel__title">Scenes</span>
        <span className="scpanel__count">{payload.scenes.length}</span>
        <span className="scpanel__spacer" />
        <Button
          className="scpanel__btn"
          title="cmd.scene('new','append',quiet=0)"
          onClick={() => void run(sceneActions.store('new'))}
        >
          +
        </Button>
        <Button
          className="scpanel__btn"
          title="cmd.scene('','previous')"
          onClick={() => void run(sceneActions.previous())}
        >
          ‹
        </Button>
        <Button
          className="scpanel__btn"
          title="cmd.scene('','next')"
          onClick={() => void run(sceneActions.next())}
        >
          ›
        </Button>
        <Button
          className="scpanel__btn"
          title="cmd.scene_order('*', sort=1)"
          onClick={() => void run(sceneActions.sort())}
        >
          sort
        </Button>
      </div>

      {/* --- the buttons overlay row ------------------------------------ *
       * The LAYOUT is `SceneDrawButtons`' (`./sceneButtonGeometry.ts`): 8-dip
       * character cells, `internal_gui_control_size` row height, names cut to
       * `max_char`, and a scrollbar once the list is longer than `n_disp`
       * rows. Until the engine has answered `cmd.get_viewport` there is no
       * block to lay anything out in, so the strip degrades to an untruncated
       * flex row rather than rendering nothing.
       */}
      {buttons !== false && (
        <div
          className={'scbar modern:bg-pm-panel-alt' + (layout?.shown ? ' scbar--laid' : '')}
          role="toolbar"
          aria-label="scene buttons"
          onWheel={(event) => {
            if (!layout?.scrollBar) return;
            event.preventDefault();
            setSkip((value) =>
              Math.max(
                0,
                Math.min(payload.scenes.length - layout.nDisp, value + (event.deltaY > 0 ? 1 : -1)),
              ),
            );
          }}
          style={
            layout?.shown
              ? // The drawn count, not `n_disp`: the loop can stop early on the
                // `y < rect.bottom` break, and a strip taller than its stack is
                // dead space that swallows clicks meant for the table below.
                { height: layout.buttons.length * layout.lineHeight }
              : undefined
          }
        >
          {payload.scenes.length === 0 && (
            <span className="scbar__empty modern:text-pm-text-dim">no scenes</span>
          )}
          {layout?.scrollBar && (
            <div
              className="scbar__scroll"
              role="scrollbar"
              aria-label="scene buttons"
              aria-valuenow={skip}
              aria-valuemin={0}
              aria-valuemax={Math.max(0, layout.scrollBar.total - layout.scrollBar.visible)}
              style={{ width: layout.scrollBar.width }}
            >
              <div
                className="scbar__thumb"
                style={{
                  top: `${((skip / layout.scrollBar.total) * 100).toFixed(2)}%`,
                  height: `${((layout.scrollBar.visible / layout.scrollBar.total) * 100).toFixed(2)}%`,
                }}
              />
            </div>
          )}
          {visibleScenes.map((scene, index) => {
            const box = layout?.shown ? layout.buttons[index] : undefined;
            // The index the C machine reasons about is the SCENE ORDER's, not
            // this map's: `NSkip` rows may be scrolled past, and a drag that
            // computed `scene_order` from the on-screen position would move the
            // wrong scene the moment the strip was scrolled.
            const orderIndex = payload.order.indexOf(scene.name);
            return (
              <button
                key={scene.name}
                type="button"
                className={
                  'scbar__btn' +
                  (scene.current ? ' is-current' : ' modern:bg-btn modern:text-pm-text') +
                  (dragIndex === orderIndex ? ' is-dragging' : '') +
                  (box?.truncated ? ' is-truncated' : '')
                }
                title={scene.message || scene.name}
                data-full-name={scene.name}
                style={
                  box
                    ? {
                        position: 'absolute',
                        left: box.left,
                        // `stackOffset`, NOT `topOffset`: this strip is only as
                        // tall as the stack, where PyMOL's block is the whole
                        // viewport. See `sceneButtonGeometry.ts`.
                        top: box.stackOffset,
                        width: box.width,
                        height: box.height,
                        fontSize: layout ? layout.charWidth * 1.25 : undefined,
                      }
                    : undefined
                }
                onMouseDown={(event) => onButtonDown(scene, orderIndex, event)}
                onMouseEnter={(event) => onButtonEnter(scene, orderIndex, event)}
                onMouseUp={(event) => onButtonUp(scene, orderIndex, event)}
                onContextMenu={(event) => event.preventDefault()}
              >
                {box ? box.label : scene.name}
              </button>
            );
          })}
        </div>
      )}

      {/* --- the Scene Panel table -------------------------------------- */}
      {/*
       * `scene_bin_gui.py:150` puts this instruction under the table. Kept
       * verbatim in meaning, reworded for what this panel actually does:
       * upstream says "load into Workspace", which is Qt's word for recall.
       */}
      <p className="scpanel__hint modern:text-pm-text-dim">Double-click a row to recall that scene.</p>
      <div className="scpanel__rows">
        {payload.scenes.map((scene, index) => (
          <div
            className={`scrow${scene.current ? ' is-current modern:bg-accent-soft' : ''}${
              selected === scene.name ? ' is-selected' : ''
            }${dragging !== null && dropAt === index ? ' is-dropzone' : ''}`}
            key={scene.name}
            onDoubleClick={() => void run(sceneActions.recall(scene.name))}
            onClick={() => setSelected(scene.name)}
            onPointerEnter={() => {
              if (dragging !== null) setDropAt(index);
            }}
            onPointerUp={() => commitDrag(index)}
            role="presentation"
          >
            {/*
             * A REAL drag, not a click.
             *
             * This handle used to move the row up exactly one position per
             * click, which is not what a drag handle claims to do — moving a
             * scene from the end to the front of a ten-scene list took nine
             * clicks and nine `scene_order` round trips.
             *
             * Pointer events with capture, the same primitive `AppShell`'s
             * splitters use; no drag-and-drop library. `dropAt` is the row the
             * pointer is over, and the reorder is issued once, on release.
             */}
            <button
              type="button"
              className={`scrow__handle modern:text-pm-text-dim${dragging === scene.name ? ' is-dragging' : ''}`}
              title="drag to reorder — cmd.scene_order"
              aria-label={`reorder ${scene.name}`}
              onPointerDown={(event) => {
                event.preventDefault();
                event.stopPropagation();
                setDragging(scene.name);
                setDropAt(index);
              }}
              onPointerEnter={() => {
                if (dragging !== null) setDropAt(index);
              }}
              onKeyDown={(event) => {
                // Keyboard equivalent, because a pointer drag is not operable
                // without a pointer.
                const delta = event.key === 'ArrowUp' ? -1 : event.key === 'ArrowDown' ? 1 : 0;
                if (delta === 0) return;
                event.preventDefault();
                const target = Math.min(payload.order.length - 1, Math.max(0, index + delta));
                if (target !== index) {
                  void run(sceneActions.order(reorder(payload.order, scene.name, target)));
                }
              }}
            >
              ⋮⋮
            </button>

            <div className="scrow__thumb">
              {thumbs[scene.name]?.data ? (
                <img
                  alt={`${scene.name} preview`}
                  src={`data:image/png;base64,${thumbs[scene.name]?.data ?? ''}`}
                />
              ) : (
                <span className="scrow__nothumb">no preview</span>
              )}
            </div>

            <div className="scrow__body">
              {renaming === scene.name ? (
                <span className="scrow__renamewrap">
                  <TextInput
                    className={`scrow__rename${renameError ? ' is-invalid' : ''}`}
                    value={draft}
                    autoFocus
                    spellCheck={false}
                    aria-invalid={renameError !== null}
                    onChange={(event) => {
                      setDraft(event.target.value);
                      setRenameError(null);
                    }}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') void commitRename(scene);
                      if (event.key === 'Escape') {
                        setRenaming(null);
                        setRenameError(null);
                      }
                    }}
                    aria-label="scene name"
                  />
                  {renameError !== null && (
                    <span className="scrow__renameerr" role="alert">
                      {renameError}
                    </span>
                  )}
                </span>
              ) : (
                <Button
                  className="scrow__name"
                  onDoubleClick={(event) => {
                    event.stopPropagation();
                    setDraft(scene.name);
                    setRenaming(scene.name);
                  }}
                >
                  {scene.name}
                </Button>
              )}
              <TextInput
                className="scrow__message"
                value={scene.message}
                placeholder="message"
                spellCheck={false}
                onChange={(event) => {
                  const message = event.target.value;
                  void session
                    .call('cmd.set_scene_message', [scene.name, message])
                    .then(() => refresh());
                }}
                aria-label={`${scene.name} message`}
              />
              <div className="scrow__stores">
                {(scene.stores ?? []).map((store) => (
                  <span className="scrow__store modern:rounded modern:bg-pm-panel-alt modern:text-pm-text-dim" key={store}>
                    {store}
                  </span>
                ))}
              </div>
            </div>

            <div className="scrow__ops">
              <Button
                title="cmd.scene(name,'update')"
                onClick={() => void run(sceneActions.update(scene.name))}
              >
                upd
              </Button>
              <Button
                title="cmd.scene(name,'clear')"
                onClick={() => void run(sceneActions.clear(scene.name))}
              >
                del
              </Button>
            </div>
          </div>
        ))}
      </div>

      {/*
       * Named views (`cmd.view`) live here rather than in their own slot: the
       * user's question is "where is my saved camera", and the answer for
       * scenes and for views is the same place. They are NOT the same feature
       * — see `viewActions.ts`.
       */}
      <ViewList />

      <SceneMenu
        current={payload.current}
        scenes={payload.order}
        buttons={buttons}
        onRun={(action) => {
          // Re-read after every menu write: `Buttons` writes the setting and
          // `Cache` can change nothing visible, so one cheap read covers both.
          void run(action).then(readButtons);
        }}
        onCommand={(line) => void session.run(line)}
      />

      {menuFor && (
        /*
         * `pymol.menu.scene_menu`, rendered by the SAME popup the object panel
         * and the sequence viewer use — `MenuActivate*` is one entry point in
         * the C, so there is one renderer here too. The three leaves are
         * PyMOL's own command strings (`cmd.wizard("renaming",...)`,
         * `cmd.scene(...,"update")`, `cmd.scene(...,"delete")`) and they go
         * out as `{t:'do'}`, which is what `PopUp.cpp:471-475` does with them.
         */
        <RowMenu
          title={`Scene ${menuFor.name}`}
          op="A"
          menuName="scene_menu"
          items={menuFor.items ?? []}
          loading={menuFor.items === null}
          error={menuFor.error}
          anchor={menuFor.at}
          onPick={(command) => {
            setMenuFor(null);
            void session.run(command);
            void refresh();
          }}
          onExpand={() => {
            /* `scene_menu` is three leaves and two separators; nothing is lazy. */
          }}
          onClose={() => setMenuFor(null)}
        />
      )}
    </div>
  );
}
