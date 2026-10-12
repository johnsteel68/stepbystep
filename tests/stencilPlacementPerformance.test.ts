import test from 'node:test';
import assert from 'node:assert/strict';
import { applyStencilText, createStencilPlacementValidator, textMinimumHeight } from '../stencilText.ts';
import { createDefaultProject } from '../projectDefaults.ts';

test('prepared drag validation matches commit validation, including rejected edges and bends', () => {
  for (const bendCount of [0, 1]) {
    const state = { ...createDefaultProject(), bendCount, width: 300 };
    const config = { text: 'RORO', font: 'stencil-google-londrina' as const,
      height: textMinimumHeight(state.thickness, 'stencil-google-londrina'), x: 150, y: 150, rotation: 0 as const };
    const validate = createStencilPlacementValidator(state, 'A', config);
    for (const x of [1, 100, 150, 200, 299]) for (const y of [1, 150, 299]) {
      const next = { ...config, x, y };
      let expected;
      try { expected = applyStencilText(state, 'A', next); }
      catch (error) { assert.throws(() => validate(next), { message: (error as Error).message }); continue; }
      assert.deepEqual(validate(next), expected);
    }
    assert.throws(() => validate({ ...config, x: NaN }));
    // Geometry edits fall back to the complete validator, never stale outlines.
    const rotated = { ...config, rotation: 90 as const };
    assert.deepEqual(validate(rotated), applyStencilText(state, 'A', rotated));
  }
});
