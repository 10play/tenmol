/* global document, window, location, FontFace, requestAnimationFrame */
// Browser entry. Headless capture calls window.renderFrame(i); open with ?play to preview live.

import { W, H, FPS, DURATION } from './lib.mjs';
import { buildProtein, buildCaffeine } from './data.mjs';
import { createReel } from './scenes.mjs';
import { createPost } from './post.mjs';

async function boot() {
  for (const [family, url] of [
    ['SG', '/fonts/space-grotesk.woff2'],
    ['JB', '/fonts/jetbrains-mono.woff2'],
  ]) {
    const f = new FontFace(family, `url(${url})`, { weight: '300 800' });
    document.fonts.add(await f.load());
  }
  const pdb = await (await fetch('/pdb/1tii.pdb')).text();
  const layer = document.createElement('canvas');
  layer.width = W;
  layer.height = H;
  const ctx = layer.getContext('2d', { willReadFrequently: false });
  const drawFrame = createReel(ctx, { protein: buildProtein(pdb), caffeine: buildCaffeine() });
  const out = document.getElementById('out');
  const post = createPost(out, W, H);

  window.renderFrame = (i) => post(layer, drawFrame(i));
  window.grab = (i, q = 0.95) => {
    window.renderFrame(i);
    return out.toDataURL('image/jpeg', q);
  };
  window.TOTAL_FRAMES = FPS * DURATION;

  const params = new URLSearchParams(location.search);
  if (params.has('play')) {
    const t0 = performance.now() - (+params.get('t') || 0) * 1000;
    const loop = () => {
      const f = Math.floor(((performance.now() - t0) / 1000) * FPS) % window.TOTAL_FRAMES;
      window.renderFrame(f);
      requestAnimationFrame(loop);
    };
    loop();
  }
}

window.ready = boot();
