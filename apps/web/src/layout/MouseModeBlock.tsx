import type { FrameState, MouseModeState } from './placeholderData';
import { useBridge } from '../bridge/BridgeContext';

/**
 * Mouse-mode block (ButMode) -- packages/engine/layer1/ButMode.cpp:192-395.
 *
 * Line 1 is "Mouse Mode <button_mode_name>". When `mouse_grid` is on (default 1,
 * packages/engine/layer1/SettingInfo.h:687) a 4-column matrix (L / M / R / Wheel) is drawn with rows
 * `& Keys`, `Shft`, `Ctrl`, `CtSh`, ` SnglClk`, ` DblClk`, filled with 5-char codes
 * from `CButMode::Code` (packages/engine/layer1/ButMode.cpp:497-520).
 *
 * Click behaviour (packages/engine/layer1/ButMode.cpp:149-190): the bottom two lines cycle the
 * selection mode (`mouse select_forward` / `select_backward`), everything else cycles
 * the mouse mode (`mouse forward` / `mouse backward`); right-click opens the
 * `mouse_config` popup.
 *
 * TODO(butmode): the codes are static placeholders. Real values need `ButModeGet` /
 * `ButModeTranslate` exposed to Python (parity inventory §14 items 7/8).
 */
export function MouseModeBlock({ mode, frame }: { mode: MouseModeState; frame: FrameState }) {
  const bridge = useBridge();
  const cycle = (backward: boolean) => {
    void bridge.do(`mouse ${backward ? 'backward' : 'forward'}`).catch(() => undefined);
  };

  return (
    <div className="butmode">
      <button
        type="button"
        className="butmode__title"
        title="click to cycle mouse mode (mouse forward / backward)"
        onClick={() => cycle(false)}
        onContextMenu={(e) => {
          e.preventDefault();
          bridge.appendFeedback([' [stub] mouse_config popup (packages/engine/modules/pymol/menu.py:82-101)']);
        }}
      >
        Mouse Mode <span className="butmode__mode">{mode.buttonModeName}</span>
      </button>

      {mode.mouseGrid && (
        <table className="butmode__grid">
          <thead>
            <tr>
              <th>Buttons</th>
              <th>L</th>
              <th>M</th>
              <th>R</th>
              <th>Wheel</th>
            </tr>
          </thead>
          <tbody>
            {mode.grid.map((row) => (
              <tr key={row.label}>
                <th>{row.label}</th>
                {row.cells.map((cell, i) => (
                  <td key={`${row.label}-${i}`}>{cell}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <button
        type="button"
        className="butmode__selmode"
        title="click to cycle selection mode (mouse select_forward / select_backward)"
        onClick={() => {
          void bridge.do('mouse select_forward').catch(() => undefined);
        }}
      >
        {mode.selectionLine}
      </button>

      {/* fast-redraw line -- packages/engine/layer1/ButMode.cpp:423-475 */}
      <div className="butmode__frame">
        Frame {String(frame.frame).padStart(4)}/{String(frame.nFrame).padStart(4)}
      </div>
    </div>
  );
}
