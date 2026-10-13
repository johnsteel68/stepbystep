import test from 'node:test';
import assert from 'node:assert/strict';
import { createDefaultProject } from '../projectDefaults.ts';
import { generateSheetProfile } from '../sheetGeometry.ts';
import { wingDimensionLayout } from '../viewer/annotations/wingDimensionLayout.ts';

test('dimensions and witness lines lie in each wing plane, for flat and both bend directions', () => {
  for (const bendCount of [0, 1, 2, 3, 4]) for (const angle of [-120, -90, 45, 90, 120]) {
    const state = createDefaultProject();
    state.bendCount = bendCount;
    state.bends = state.bends.map(bend => ({ ...bend, angle }));
    for (const leg of generateSheetProfile(state).legTransforms) for (const kind of ['length', 'width'] as const) {
      const layout = wingDimensionLayout(leg, state, kind);
      for (const point of [layout.baseEnd, layout.start, layout.end]) {
        assert.ok(Math.abs(point.clone().sub(layout.baseStart).dot(layout.normal)) < 1e-7, `${leg.id}/${angle}/${kind}: stays on the wing plane`);
      }
      // Profile direction vectors are rounded to six decimals for CSG.
      assert.ok(Math.abs(layout.start.distanceTo(layout.end) - layout.value) < .001);
      assert.ok(layout.start.clone().sub(layout.baseStart).dot(layout.outward) > 0);
    }
  }
});

test('L profile places width above the terminal wing and lengths outside opposite side edges', () => {
  const state = createDefaultProject();
  state.width = 400;
  const [a, b] = generateSheetProfile(state).legTransforms;
  const first = wingDimensionLayout(a, state, 'length'), last = wingDimensionLayout(b, state, 'length');
  assert.ok(first.start.z < 0);
  assert.ok(last.start.z > state.width);
  const width = wingDimensionLayout(b, state, 'width');
  assert.equal(width.baseStart.z, 0);
  assert.equal(width.baseEnd.z, 400);
  assert.ok(width.start.y > width.baseStart.y);
  assert.equal(width.value, 400);
});
