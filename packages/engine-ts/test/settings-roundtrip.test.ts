/**
 * Set/get roundtrips for settings whose *default* is environment- or
 * config-dependent (so a plain default-read diverges from any given oracle):
 *   - max_threads   — real PyMOL seeds it to the core count at startup
 *   - internal_gui / internal_feedback — the headless bridge starts them at 0
 *   - ribbon_color / bg_rgb — colour-typed, read back as a colour index
 * The portable, oracle-agnostic verification is a roundtrip: set a concrete
 * value, read it back. Ground truth is the oracle (real PyMOL 3.2.0a); see the
 * committed probes setting__{max_threads,internal_gui,internal_feedback,
 * ribbon_color,bg_rgb}.json.
 */
import { describe, it, expect } from 'vitest';
import { LocalBackend } from '@tenmol/engine-ts';

async function boot() {
  const b = new LocalBackend();
  await b.connect();
  return b;
}

describe('setting set/get roundtrips (env-independent)', () => {
  it('roundtrips integer settings', async () => {
    const b = await boot();
    await b.call('set', ['internal_gui', 0]);
    await b.call('set', ['internal_feedback', 3]);
    await b.call('set', ['max_threads', 4]);
    expect(await b.call('get_setting_int', ['internal_gui'])).toBe(0);
    expect(await b.call('get_setting_int', ['internal_feedback'])).toBe(3);
    expect(await b.call('get_setting_int', ['max_threads'])).toBe(4);
    b.close();
  });

  it('roundtrips colour settings to the colour index', async () => {
    const b = await boot();
    await b.call('set', ['ribbon_color', 'blue']);
    await b.call('set', ['bg_rgb', 'red']);
    expect(await b.call('get_setting_int', ['ribbon_color'])).toBe(
      await b.call('get_color_index', ['blue']),
    );
    expect(await b.call('get_setting_int', ['bg_rgb'])).toBe(
      await b.call('get_color_index', ['red']),
    );
    b.close();
  });
});
