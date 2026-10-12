import assert from 'node:assert/strict';
import test from 'node:test';
import { createDefaultProject, DEFAULT_HOLE_DIAMETER } from '../projectDefaults.ts';

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
