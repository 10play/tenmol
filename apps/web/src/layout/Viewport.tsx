import { useEffect, useRef } from 'react';
import { useBridge } from '../bridge/BridgeContext';

/**
 * The 3D viewport area -- the "central widget" (PyMOLGLWidget,
 * packages/engine/modules/pmg_qt/pymol_qt_gui.py:207-208).
 *
 * THIS IS A MOUNT POINT ONLY.
 *
 * TODO(viewport): the `@tenmol/viewport` package owns everything that draws into this
 * canvas -- the renderer, the camera, geometry upload from the binary `geometry`
 * frames, picking, and mouse/keyboard input forwarding
 * (`{t:'input',kind:'button'|'drag'}`). It will take this `<canvas>` element by ref.
 * Nothing in apps/web may acquire a WebGL context or attach pointer handlers here.
 *
 * What the shell *does* own is the size of the mount: it reports it to the backend as
 * `{t:'input',kind:'reshape'}`, which is what `cmd.viewport` / `OrthoReshape`
 * (packages/engine/layer1/Ortho.cpp:2340-2463) consume.
 */
export function Viewport() {
  const hostRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const bridge = useBridge();
  const inputRef = useRef(bridge.input);
  inputRef.current = bridge.input;
  const reportRef = useRef<(force?: boolean) => void>(() => {});

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let last = '';
    const report = (force = false) => {
      const rect = host.getBoundingClientRect();
      // TODO(viewport): decide CSS px vs device px with the renderer; PyMOL wants
      // framebuffer pixels, so this will likely become rect.width * devicePixelRatio.
      const width = Math.max(1, Math.round(rect.width));
      const height = Math.max(1, Math.round(rect.height));
      const key = `${width}x${height}`;
      if (key === last && !force) return;
      last = key;
      const canvas = canvasRef.current;
      if (canvas) {
        canvas.width = width;
        canvas.height = height;
      }
      inputRef.current({ t: 'input', kind: 'reshape', width, height, force });
    };
    reportRef.current = report;
    const ro = new ResizeObserver(() => report());
    ro.observe(host);
    report();
    return () => ro.disconnect();
  }, []);

  // Input frames are dropped while the socket is down (they carry no id and must not
  // be replayed stale). The very first report therefore almost always happens before
  // the socket opens, so re-report on every transition to 'open' -- otherwise the
  // backend keeps its startup viewport size (win_x/win_y, invocation.py:144-145)
  // and every pick coordinate is wrong.
  useEffect(() => {
    if (bridge.status === 'open') reportRef.current(true);
  }, [bridge.status]);

  return (
    <div className="viewport" ref={hostRef}>
      <canvas className="viewport__canvas" ref={canvasRef} data-tenmol-viewport-mount="true" />
      <div className="viewport__placeholder">
        <div className="viewport__placeholder-title">3D viewport mount point</div>
        <div className="viewport__placeholder-sub">
          @tenmol/viewport attaches to <code>canvas[data-tenmol-viewport-mount]</code>
        </div>
      </div>
    </div>
  );
}
