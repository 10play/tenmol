import { useBridge } from '../bridge/BridgeContext';

/**
 * The quick-button grid of the External GUI -- packages/engine/modules/pmg_qt/pymol_qt_gui.py:222-271.
 * Four rows, `spacing 2`, every button carrying `quickbutton=true`.
 * Row 3 (the movie transport) is intentionally omitted here: it is the same set of
 * actions as the Control block, which the shell renders bottom-right where PyMOL draws
 * it (packages/engine/layer1/Control.cpp).
 *
 * Below the grid sits the progress row (:273-284): a QProgressBar plus a red `Abort`
 * button wired to `cmd.interrupt`, shown only while `cmd.get_progress() >= 0`
 * (:931-939).
 */

const ROWS: { label: string; cmd: string; title: string }[][] = [
  [
    { label: 'Reset', cmd: 'reset', title: 'cmd.reset' },
    { label: 'Zoom', cmd: 'zoom animate=1.0', title: 'cmd.zoom(animate=1.0)' },
    { label: 'Orient', cmd: 'orient animate=1.0', title: 'cmd.orient(animate=1.0)' },
    { label: 'Draw/Ray', cmd: 'ray', title: 'render dialog (WidgetMenu, lazily built)' },
  ],
  [
    { label: 'Unpick', cmd: 'unpick', title: 'cmd.unpick' },
    { label: 'Deselect', cmd: 'deselect', title: 'cmd.deselect' },
    { label: 'Rock', cmd: 'rock', title: 'cmd.rock' },
    { label: 'Get View', cmd: 'get_view 2, quiet=0', title: 'cmd.get_view(2, quiet=0)' },
  ],
  [
    { label: 'Builder', cmd: '', title: 'opens the builder dock (stub)' },
    { label: 'Properties', cmd: '', title: 'opens the properties dialog (stub)' },
    { label: 'Rebuild', cmd: 'rebuild', title: 'cmd.rebuild' },
    { label: 'MClear', cmd: 'mclear', title: 'cmd.mclear' },
  ],
];

/** Renders the External-GUI quick-button grid (Reset, Zoom, Orient, ...), each running a `cmd` verb. */
export function QuickButtons() {
  const bridge = useBridge();
  return (
    <div className="quickbuttons">
      {ROWS.map((row, i) => (
        <div className="quickbuttons__row" key={i}>
          {row.map((b) => (
            <button
              type="button"
              className="quickbutton"
              key={b.label}
              title={b.title}
              onClick={() => {
                if (b.cmd) {
                  void bridge.do(b.cmd).catch(() => undefined);
                } else {
                  bridge.appendFeedback([` [stub] ${b.label}`]);
                }
              }}
            >
              {b.label}
            </button>
          ))}
        </div>
      ))}
      <div className="quickbuttons__progress" title="shown while cmd.get_progress() >= 0">
        <div className="progressbar" aria-hidden="true">
          <div className="progressbar__fill" style={{ width: '0%' }} />
        </div>
        <button
          type="button"
          className="quickbutton quickbutton--abort"
          title="cmd.interrupt"
          onClick={() => bridge.appendFeedback([' [stub] interrupt'])}
        >
          Abort
        </button>
      </div>
    </div>
  );
}
