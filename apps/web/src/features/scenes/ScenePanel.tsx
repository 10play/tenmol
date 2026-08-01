/**
 * Slot `scenes`, region `internal-gui`. Plan §6 WP-20.
 *
 * Two surfaces in one panel, because in PyMOL they are two surfaces over the
 * same list:
 *
 *  * the **scene buttons** overlay (`layer1/Scene.cpp:2885` `SceneDrawButtons`
 *    / `SceneClickButton`) — left click recalls on release over the same
 *    button, middle is "rapid browse" (recall on press and while dragging,
 *    `animate=0` with Ctrl), right opens `scene_menu` (`menu.py:1842`), and
 *    dragging reorders via `cmd.scene_order`. Current scene draws brighter
 *    than the rest (0.5 vs 0.25).
 *  * the **Scene Panel** dialog (`modules/pmg_qt/scene_bin_gui.py:29`) — Add
 *    Scene, name/preview columns, rename, Update, Delete, double-click to
 *    recall, drag handles to reorder. Its Message and Actions columns are
 *    hard-coded placeholders upstream; here Message is bound to the real
 *    `get_scene_message`/`set_scene_message`, which is what the inventory says
 *    it should have been.
 */

import { useEffect, useState } from 'react';
import type { SceneRecord } from '@tenmol/protocol/topics/movie';
import { useSession } from '../../app';
import { useScenes } from './useScenes';
import { SceneMenu } from './SceneMenu';
import { ViewList } from './ViewList';
import { renameProblem, reorder, sceneActions } from './sceneActions';
import './scenes.css';

export function ScenePanel() {
  const session = useSession();
  const { payload, thumbs, run, loadThumb, refresh } = useScenes();
  const [selected, setSelected] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [menuFor, setMenuFor] = useState<{ name: string; at: { x: number; y: number } } | null>(
    null,
  );
  const [dragging, setDragging] = useState<string | null>(null);
  const [browsing, setBrowsing] = useState(false);
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

  useEffect(() => {
    for (const scene of payload.scenes) {
      if (!thumbs[scene.name]) void loadThumb(scene.name);
    }
    // Re-request only for names we have not resolved yet.
  }, [payload.scenes, thumbs, loadThumb]);

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

  const onButtonDown = (scene: SceneRecord, event: React.MouseEvent) => {
    if (event.button === 1) {
      event.preventDefault();
      setBrowsing(true);
      void run(event.ctrlKey ? sceneActions.browse(scene.name) : sceneActions.recall(scene.name));
      return;
    }
    if (event.button === 0) setDragging(scene.name);
  };

  const onButtonEnter = (scene: SceneRecord) => {
    if (browsing) void run(sceneActions.browse(scene.name));
  };

  const onButtonUp = (scene: SceneRecord, event: React.MouseEvent) => {
    setBrowsing(false);
    if (event.button === 2) {
      event.preventDefault();
      setMenuFor({ name: scene.name, at: { x: event.clientX, y: event.clientY } });
      return;
    }
    if (event.button !== 0) return;
    if (dragging && dragging !== scene.name) {
      const index = payload.order.indexOf(scene.name);
      void run(sceneActions.order(reorder(payload.order, dragging, index)));
      setDragging(null);
      return;
    }
    setDragging(null);
    setSelected(scene.name);
    void run(sceneActions.recall(scene.name));
  };

  return (
    <div className="scpanel">
      <div className="scpanel__head">
        <span className="scpanel__title">Scenes</span>
        <span className="scpanel__count">{payload.scenes.length}</span>
        <span className="scpanel__spacer" />
        <button
          type="button"
          className="scpanel__btn"
          title="cmd.scene('new','append',quiet=0)"
          onClick={() => void run(sceneActions.store('new'))}
        >
          +
        </button>
        <button
          type="button"
          className="scpanel__btn"
          title="cmd.scene('','previous')"
          onClick={() => void run(sceneActions.previous())}
        >
          ‹
        </button>
        <button
          type="button"
          className="scpanel__btn"
          title="cmd.scene('','next')"
          onClick={() => void run(sceneActions.next())}
        >
          ›
        </button>
        <button
          type="button"
          className="scpanel__btn"
          title="cmd.scene_order('*', sort=1)"
          onClick={() => void run(sceneActions.sort())}
        >
          sort
        </button>
      </div>

      {/* --- the buttons overlay row ------------------------------------ */}
      <div className="scbar" role="toolbar" aria-label="scene buttons">
        {payload.scenes.length === 0 && <span className="scbar__empty">no scenes</span>}
        {payload.scenes.map((scene) => (
          <button
            key={scene.name}
            type="button"
            className={
              'scbar__btn' +
              (scene.current ? ' is-current' : '') +
              (dragging === scene.name ? ' is-dragging' : '')
            }
            title={scene.message || scene.name}
            onMouseDown={(event) => onButtonDown(scene, event)}
            onMouseEnter={() => onButtonEnter(scene)}
            onMouseUp={(event) => onButtonUp(scene, event)}
            onContextMenu={(event) => event.preventDefault()}
          >
            {scene.name}
          </button>
        ))}
      </div>

      {/* --- the Scene Panel table -------------------------------------- */}
      {/*
        * `scene_bin_gui.py:150` puts this instruction under the table. Kept
        * verbatim in meaning, reworded for what this panel actually does:
        * upstream says "load into Workspace", which is Qt's word for recall.
        */}
      <p className="scpanel__hint">Double-click a row to recall that scene.</p>
      <div className="scpanel__rows">
        {payload.scenes.map((scene, index) => (
          <div
            className={`scrow${scene.current ? ' is-current' : ''}${
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
              className={`scrow__handle${dragging === scene.name ? ' is-dragging' : ''}`}
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
                  <input
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
                <button
                  type="button"
                  className="scrow__name"
                  onDoubleClick={(event) => {
                    event.stopPropagation();
                    setDraft(scene.name);
                    setRenaming(scene.name);
                  }}
                >
                  {scene.name}
                </button>
              )}
              <input
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
                  <span className="scrow__store" key={store}>
                    {store}
                  </span>
                ))}
              </div>
            </div>

            <div className="scrow__ops">
              <button
                type="button"
                title="cmd.scene(name,'update')"
                onClick={() => void run(sceneActions.update(scene.name))}
              >
                upd
              </button>
              <button
                type="button"
                title="cmd.scene(name,'clear')"
                onClick={() => void run(sceneActions.clear(scene.name))}
              >
                del
              </button>
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
        onRun={(action) => void run(action)}
        onCommand={(line) => void session.run(line)}
      />

      {menuFor && (
        <div
          className="scpopup__scrim"
          onClick={() => setMenuFor(null)}
          role="presentation"
        >
          <div
            className="scpopup"
            style={{ left: menuFor.at.x, top: menuFor.at.y }}
            onClick={(event) => event.stopPropagation()}
            role="menu"
          >
            <div className="scpopup__head">Scene {menuFor.name}</div>
            <button
              type="button"
              onClick={() => {
                setDraft(menuFor.name);
                setRenaming(menuFor.name);
                setMenuFor(null);
              }}
            >
              rename
            </button>
            <button
              type="button"
              onClick={() => {
                void run(sceneActions.update(menuFor.name));
                setMenuFor(null);
              }}
            >
              update
            </button>
            <button
              type="button"
              onClick={() => {
                void run(sceneActions.clear(menuFor.name));
                setMenuFor(null);
              }}
            >
              delete
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
