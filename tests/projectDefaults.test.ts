import assert from 'node:assert/strict';
import test from 'node:test';
import { createDefaultProject, DEFAULT_HOLE_DIAMETER, selectProjectBendCount } from '../projectDefaults.ts';
import { checkSheetCollision } from '../sheetGeometry.ts';

test('selecting three or four bends opens a collision-free staircase', () => {
  for (const count of [3, 4]) {
    const state = createDefaultProject();
    state.bends = state.bends.map(bend => ({ ...bend, angle: 90, direction: 1 }));
    const next = selectProjectBendCount(state, count);
    assert.equal(next.bendCount, count);
    assert.deepEqual(next.bends.slice(0, count).map(bend => bend.direction), [1, -1, 1, -1].slice(0, count));
    assert.ok(next.bends.slice(0, count).every(bend => bend.angle === 90));
    assert.equal(checkSheetCollision(next).hasCollision, false);
    assert.equal(next.legs, state.legs);
    assert.ok(state.bends.every(bend => bend.direction === 1));
  }
});

test('reselecting the same count or choosing zero to two bends preserves custom angles', () => {
  const state = createDefaultProject();
  state.bendCount = 3;
  state.bends[0] = { ...state.bends[0], angle: 65, direction: -1 };
  for (const count of [0, 1, 2, 3]) {
    assert.equal(selectProjectBendCount(state, count).bends, state.bends);
  }
});

test('new project has one bend and five millimetre hole defaults', () => {
  const state = createDefaultProject();
  assert.equal(state.bendCount, 1);
  assert.equal(state.width, 300);
  assert.ok(state.legs.every(leg => leg.length === 300));
  assert.equal(DEFAULT_HOLE_DIAMETER, 5);
  assert.equal(state.legs.length, 5);
  assert.ok(state.legs.every(leg => !leg.hasHole && leg.holeDiam === 5));
});

test('default arrays and corners are not shared between projects', () => {
  const first = createDefaultProject();
  const second = createDefaultProject();
  first.legs[0].length = 200;
  first.bends[0].angle = 45;
  first.cornerRadii!.startLeft = 10;
  assert.equal(second.legs[0].length, 300);
  assert.equal(second.bends[0].angle, 90);
  assert.equal(second.cornerRadii!.startLeft, 0);
});
