/**
 * The rubber-band selection rectangle — `OrthoDrawLoop`
 * (`layer1/Ortho.cpp:1695-1745`), drawn here as a 1 px CSS box over the
 * viewport instead of four `cColorFront` quads in the ortho CGO.
 *
 * IT HAS TO BE LOCAL.  `I->LoopRect` is written by `SceneLoopClick` /
 * `SceneLoopDrag` and mirrored into Ortho by `OrthoSetLoopRect`
 * (`layer1/SceneMouse.cpp:44-66`); nothing publishes it, and
 * `test_wf_ortho.py::test_the_marquee_rectangle_is_not_readable_from_python`
 * measures that there is no getter to add to the pump.  The SELECTION is
 * unaffected: the press/drag/release this component watches are the same
 * events `@tenmol/viewport` forwards, and `ExecutiveSelectRect` still makes
 * the selection in the C (`bridge/tests/test_box_selection.py`).
 *
 * IT NEVER TOUCHES THE EVENTS.  Listeners are `capture: true, passive: true`
 * on the viewport host and on `window`; nothing is prevented, stopped or
 * synthesised, so the viewport's own `InputController` sees exactly the stream
 * it would have seen without this component.  The drawn div is
 * `pointer-events: none`.
 *
 * WHICH DRAGS COUNT.  `SceneClick` starts the loop for six action codes
 * (`SceneMouse.cpp:803-809`); resolving the code needs the 80-slot ButMode
 * table, which is derived from `button_mode_name` — the same authoritative
 * string `features/mouse` reads, because `ButModeGet` is C-only.  The name is
 * fetched at mount and refreshed after each gesture (never during one: an
 * ordinary RPC cannot answer while the engine is busy, measured in
 * `test_wf_ortho.py`).
 */

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { modifierMask } from '@tenmol/protocol';
import { useSession } from '../../app';
import {
  DEFAULT_MODE,
  loopBox,
  loopKindFor,
  tableForDisplayName,
  type LoopBox,
  type LoopKind,
} from './orthoOverlays';
import { tableForMode } from '../../../../../packages/viewport/src/input/mouseConfig';

interface Drag {
  kind: LoopKind;
  box: LoopBox;
}

export function OrthoLoopRect() {
  const session = useSession();
  const [host, setHost] = useState<HTMLElement | null>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const table = useRef<readonly number[]>(tableForMode(DEFAULT_MODE));

  useEffect(() => {
    setHost(document.querySelector<HTMLElement>('.shell__viewport'));
  }, []);

  /** `cmd.get_setting_text('button_mode_name')` -> the 80-slot table. */
  const refreshTable = useRef(() => {
    void session
      .call<string>('cmd.get_setting_text', ['button_mode_name'])
      .then((name) => {
        if (typeof name === 'string' && name) table.current = tableForDisplayName(name);
      })
      .catch(() => undefined);
  });

  useEffect(() => {
    refreshTable.current();
  }, []);

  useEffect(() => {
    if (!host) return;
    let press: { x: number; y: number } | null = null;
    let kind: LoopKind | null = null;

    const local = (event: PointerEvent | MouseEvent) => {
      const rect = host.getBoundingClientRect();
      return { x: event.clientX - rect.left, y: event.clientY - rect.top };
    };

    const onDown = (event: PointerEvent) => {
      if (event.pointerType === 'touch') return;
      // A press that lands on another ortho BLOCK never reaches the scene:
      // `OrthoButton` gives the click to the block under the cursor
      // (`layer1/Ortho.cpp:2530-2600`), so the console band and the busy box
      // swallow it and no rubber band starts.
      const target = event.target;
      if (target instanceof Element && target.closest('.ortho, .ortho-busy')) return;
      kind = loopKindFor(table.current, event.button, modifierMask(event));
      if (!kind) return;
      press = local(event);
      setDrag({ kind, box: loopBox(press, press) });
    };

    const onMove = (event: PointerEvent) => {
      if (!press || !kind) return;
      setDrag({ kind, box: loopBox(press, local(event)) });
    };

    const onUp = () => {
      if (!press) return;
      press = null;
      kind = null;
      setDrag(null);
      // The mode can have been changed by the very gesture that just ended
      // (`Sele` cycles nothing, but the ButMode block and `cmd.mouse` do), so
      // re-read now that the engine is idle again.
      refreshTable.current();
    };

    const opts = { capture: true, passive: true } as const;
    host.addEventListener('pointerdown', onDown as EventListener, opts);
    window.addEventListener('pointermove', onMove as EventListener, opts);
    window.addEventListener('pointerup', onUp, opts);
    window.addEventListener('pointercancel', onUp, opts);
    // A drag that leaves the window and comes back released is still over.
    window.addEventListener('blur', onUp, opts);
    return () => {
      host.removeEventListener('pointerdown', onDown as EventListener, opts);
      window.removeEventListener('pointermove', onMove as EventListener, opts);
      window.removeEventListener('pointerup', onUp, opts);
      window.removeEventListener('pointercancel', onUp, opts);
      window.removeEventListener('blur', onUp, opts);
    };
  }, [host]);

  if (!host || !drag) return null;

  return createPortal(
    <div
      className={`ortho-loop ortho-loop--${drag.kind}`}
      data-testid="ortho-loop"
      data-kind={drag.kind}
      aria-hidden="true"
      style={{
        left: drag.box.left,
        top: drag.box.top,
        width: drag.box.width,
        height: drag.box.height,
      }}
    />,
    host,
  );
}
