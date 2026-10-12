import assert from 'node:assert/strict';
import { test } from 'node:test';
import { getGrainConstraints } from '../grainConstraints.ts';
import { createDefaultProject } from '../projectDefaults.ts';

function flat(length: number, width: number) {
  const state = createDefaultProject();
  return { ...state, bendCount: 0, finish: 'stainless-brushed' as const,
    width, legs: state.legs.map((leg, i) => i === 0 ? { ...leg, length } : leg) };
}
test('brush limits include exact stock dimensions and turn when necessary', () => {
  assert.equal(getGrainConstraints(flat(2980, 1480), 'length').valid, true);
  const turned = getGrainConstraints(flat(1480, 2980), 'length');
  assert.equal(turned.valid, false);
  assert.equal(turned.nextDirection, 'width');
  assert.equal(turned.blocked, false);
  assert.equal(getGrainConstraints(flat(2980, 1480), 'width').nextDirection, 'length');
});
test('neither direction can fit oversize blanks; other finishes are unaffected', () => {
  assert.equal(getGrainConstraints(flat(1481, 1481), 'length').blocked, true);
  assert.equal(getGrainConstraints(flat(2981, 100), 'length').blocked, true);
  assert.equal(getGrainConstraints({ ...flat(2981, 100), finish: 'steel-raw' }, 'length').valid, true);
});
test('stock check uses the developed blank, not one wing', () => {
  const state = { ...flat(1000, 2000), bendCount: 1 };
  state.legs[1] = { ...state.legs[1], length: 1000 };
  assert.equal(getGrainConstraints(state, 'length').blocked, true);
});
