/**
 * `get_setting_tuple` returns PyMOL's `[typeCode, [values]]` for every setting
 * type (Setting.cpp SettingGetTuple), and `set` coerces by the setting's type:
 *   - string (type 6, e.g. `assembly`) stores the value verbatim as text
 *   - float3 (type 4, e.g. `bg_image_tilesize`) stores/reads the [x,y,z] vector
 *   - float  (type 2, e.g. `openvr_gui_scene_color`) roundtrips a scalar
 *   - colour (type 5, e.g. `ribbon_color`) stores the colour index
 * Ground truth is the oracle (real PyMOL 3.2.0a); see the committed probes
 * setting__{assembly,bg_image_tilesize,openvr_gui_scene_color}.json.
 */
import { describe, it, expect } from 'vitest';
import { LocalBackend } from '@tenmol/engine-ts';

async function boot() {
  const b = new LocalBackend();
  await b.connect();
  return b;
}

describe('get_setting_tuple type tags + typed set coercion', () => {
  it('string setting stores text and reports type 6', async () => {
    const b = await boot();
    await b.call('set', ['assembly', 1]);
    expect(await b.call('get_setting_tuple', ['assembly'])).toEqual([6, ['1']]);
    expect(await b.call('get', ['assembly'])).toBe('1');
    b.close();
  });

  it('float3 setting reports type 4 and its [x,y,z] default', async () => {
    const b = await boot();
    expect(await b.call('get_setting_tuple', ['bg_image_tilesize'])).toEqual([4, [100, 100, 0]]);
    b.close();
  });

  it('float setting roundtrips a scalar', async () => {
    const b = await boot();
    await b.call('set', ['openvr_gui_scene_color', 0.75]);
    expect(await b.call('get_setting_float', ['openvr_gui_scene_color'])).toBeCloseTo(0.75, 6);
    b.close();
  });

  it('colour setting reports type 5 holding the colour index', async () => {
    const b = await boot();
    await b.call('set', ['ribbon_color', 'blue']);
    const blue = (await b.call('get_color_index', ['blue'])) as number;
    expect(await b.call('get_setting_tuple', ['ribbon_color'])).toEqual([5, [blue]]);
    b.close();
  });
});
