/**
 * The Scene menu (`packages/engine/modules/pymol/_gui.py:775-805`), node for node.
 *
 *   Scenes... | Next [PgDn] | Previous [PgUp] | Append | Append> (Camera /
 *   Color / Reps / Reps+Color) | Insert Before | Insert After | Update |
 *   Delete | Recall> / Store> / Clear> (F1..F12 each) | Buttons check |
 *   Cache> (Enable / Optimize / Read Only / Disable)
 *
 * The F-key submenus are `F_scene_menu(action)` (`_gui.py:61`): twelve entries
 * calling `cmd.scene('F<n>', action)`. Those are also the bare-F-key bindings
 * the keyboard service falls back to, which is why the labels are exact.
 */

import { useState } from 'react';
import { Button, Checkbox } from '../../ui';
import { F_KEYS, sceneActions, type SceneAction } from './sceneActions';

interface Props {
  current: string | null;
  scenes: readonly string[];
  /** `scene_buttons`, read from the engine — null until the first read lands. */
  buttons: boolean | null;
  onRun: (action: SceneAction) => void;
  onCommand: (line: string) => void;
}

type Open = 'append' | 'recall' | 'store' | 'clear' | 'cache' | null;

export function SceneMenu({ current, scenes, buttons, onRun, onCommand }: Props) {
  const [open, setOpen] = useState<Open>(null);
  const toggle = (name: Open) => setOpen(open === name ? null : name);

  return (
    <div className="scmenu modern:border-line">
      <div className="scmenu__row">
        <Button onClick={() => onRun(sceneActions.previous())}>Previous [PgUp]</Button>
        <Button onClick={() => onRun(sceneActions.next())}>Next [PgDn]</Button>
        <Button onClick={() => onRun(sceneActions.store('new'))}>Append</Button>
        <Button onClick={() => toggle('append')}>Append…</Button>
        <Button onClick={() => onRun(sceneActions.insertBefore())}>Insert Before</Button>
        <Button onClick={() => onRun(sceneActions.insertAfter())}>Insert After</Button>
        <Button onClick={() => onRun(sceneActions.update('auto'))}>Update</Button>
        <Button onClick={() => onRun(sceneActions.clear('auto'))}>Delete</Button>
      </div>

      {open === 'append' && (
        <div className="scmenu__sub">
          <Button onClick={() => onCommand('scene new, store, color=0, rep=0')}>Camera</Button>
          <Button onClick={() => onCommand('scene new, store, view=0, rep=0')}>Color</Button>
          <Button onClick={() => onCommand('scene new, store, view=0, color=0')}>Reps</Button>
          <Button onClick={() => onCommand('scene new, store, view=0')}>Reps + Color</Button>
        </div>
      )}

      <div className="scmenu__row">
        {(['recall', 'store', 'clear'] as const).map((action) => (
          <Button
            key={action}
            className={open === action ? 'is-on' : ''}
            onClick={() => toggle(action)}
          >
            {action[0]?.toUpperCase()}
            {action.slice(1)}…
          </Button>
        ))}
        <Button className={open === 'cache' ? 'is-on' : ''} onClick={() => toggle('cache')}>
          Cache…
        </Button>
        <Button onClick={() => onRun(sceneActions.blank())}>Blank</Button>
        {/*
         * `('check', 'Buttons', 'scene_buttons')` (`_gui.py:801`). A real
         * checkbox bound to the real setting: the buttons overlay above reads
         * the same one, so unticking it here hides the overlay there.
         */}
        <label className="scmenu__check modern:text-pm-text-dim">
          <Checkbox
            checked={buttons === true}
            onChange={() => onRun(sceneActions.buttons(!buttons))}
          />
          Buttons
        </label>
        <span className="scmenu__current">current: {current ?? '(none)'}</span>
      </div>

      {(open === 'recall' || open === 'store' || open === 'clear') && (
        <div className="scmenu__sub scmenu__sub--keys">
          {F_KEYS.map((key) => (
            <Button
              key={key}
              className={scenes.includes(key) ? 'has-scene' : ''}
              onClick={() =>
                onRun(
                  open === 'recall'
                    ? sceneActions.recall(key)
                    : open === 'store'
                      ? sceneActions.store(key)
                      : sceneActions.clear(key),
                )
              }
            >
              {key}
            </Button>
          ))}
        </div>
      )}

      {open === 'cache' && (
        <div className="scmenu__sub">
          {(['enable', 'optimize', 'read_only', 'disable'] as const).map((mode) => (
            <Button key={mode} onClick={() => onRun(sceneActions.cache(mode))}>
              {mode}
            </Button>
          ))}
        </div>
      )}
    </div>
  );
}
