/**
 * The per-rep toggle and the automatic fallback.
 *
 * The property that matters: asking for Mode G NEVER results in "nothing is
 * drawn". Either the rep is drawn client-side, or it is drawn server-side and
 * the reason is named.
 */

import { strict as assert } from 'node:assert';
import { describe, test } from 'vitest';

import { Rep } from '@tenmol/protocol';

import { createRenderPolicy } from '../src/renderPolicy';

describe('render policy', () => {
  test('the default is Mode P for everything', () => {
    const policy = createRenderPolicy();
    assert.equal(policy.policy.default, 'pixel');
    assert.equal(policy.state(Rep.Cartoon).effective, 'pixel');
    assert.deepEqual(policy.geometryReps(), []);
  });

  test('a rep asked for Mode G gets it once the caps allow', () => {
    const policy = createRenderPolicy({ caps: { accessor: true, webgl: true } });
    const state = policy.setRep(Rep.Sphere, 'geometry');
    assert.equal(state.effective, 'geometry');
    assert.equal(state.fallbackReason, undefined);
    assert.deepEqual(policy.geometryReps(), [Rep.Sphere]);
  });

  test('no accessor => Mode P with reason no-accessor, not a blank screen', () => {
    const policy = createRenderPolicy({ caps: { accessor: false, webgl: true } });
    const state = policy.setRep(Rep.Cartoon, 'geometry');
    assert.equal(state.effective, 'pixel');
    assert.equal(state.fallbackReason, 'no-accessor');
    assert.match(policy.describe(), /Mode P/);
  });

  test('no WebGL2 => webgl-unavailable, and it outranks a missing accessor', () => {
    const policy = createRenderPolicy({ caps: { accessor: false, webgl: false } });
    assert.equal(policy.setRep(Rep.Surface, 'geometry').fallbackReason, 'webgl-unavailable');
  });

  test('a rep Mode G cannot express falls back with unsupported-rep', () => {
    const policy = createRenderPolicy({ caps: { accessor: true, webgl: true } });
    // labels: text, no geometry (0 bytes in every exporter, spike 03 §4)
    assert.equal(policy.setRep(Rep.Label, 'geometry').fallbackReason, 'unsupported-rep');
    assert.equal(policy.setRep(Rep.Volume, 'geometry').fallbackReason, 'unsupported-rep');
    assert.equal(policy.setRep(Rep.Callback, 'geometry').fallbackReason, 'unsupported-rep');
  });

  test('a runtime degradation is sticky until the user asks again', () => {
    const changes: number[] = [];
    const policy = createRenderPolicy({
      caps: { accessor: true, webgl: true },
      onChange: (states) => changes.push(states.length),
    });
    policy.setRep(Rep.Cartoon, 'geometry');
    assert.equal(policy.state(Rep.Cartoon).effective, 'geometry');

    policy.degrade(Rep.Cartoon, 'preshader-disposed');
    assert.equal(policy.state(Rep.Cartoon).effective, 'pixel');
    assert.equal(policy.state(Rep.Cartoon).fallbackReason, 'preshader-disposed');
    // Repeating the same degradation does not spam onChange.
    const before = changes.length;
    policy.degrade(Rep.Cartoon, 'preshader-disposed');
    assert.equal(changes.length, before);

    // Re-requesting Mode G clears it: that is the user saying "try again".
    assert.equal(policy.setRep(Rep.Cartoon, 'geometry').effective, 'geometry');
  });

  test('describe() names every fallback, so the HUD can never be silent', () => {
    const policy = createRenderPolicy({ caps: { accessor: true, webgl: true } });
    policy.setRep(Rep.Cyl, 'geometry');
    policy.setRep(Rep.Label, 'geometry');
    const text = policy.describe();
    assert.match(text, /Mode G: sticks/);
    assert.match(text, /labels \(unsupported-rep\)/);
  });

  test('caps arriving late flip the effective mode without a re-request', () => {
    const policy = createRenderPolicy({ caps: { accessor: false, webgl: true } });
    policy.setRep(Rep.Surface, 'geometry');
    assert.equal(policy.state(Rep.Surface).effective, 'pixel');
    policy.setCaps({ accessor: true });
    assert.equal(policy.state(Rep.Surface).effective, 'geometry');
  });
});
