import assert from 'node:assert/strict';
import test from 'node:test';
import { getBendingRestriction, checkSheetMetalFeasibility, getAvailableSheetFinishes, getAvailableSheetThicknesses, normalizeBendingSelection, type SheetFinish } from '../sheetGeometry.ts';
import { createDefaultProject } from '../projectDefaults.ts';

test('unsupported finishes cannot be bent, but remain valid flat', () => {
  for (const finish of ['stainless-mirror', 'aluminum-anodized', 'aluminum-antitrace', 'aluminum-perforated'] as SheetFinish[]) {
    assert.ok(getBendingRestriction(finish, 1.5));
    const state = { ...createDefaultProject(), finish, thickness: 1.5 };
    assert.ok(checkSheetMetalFeasibility(state).checks.some(c => c.id === 'bending-availability' && c.status === 'fail'));
    assert.ok(!checkSheetMetalFeasibility({ ...state, bendCount: 0 }).checks.some(c => c.id === 'bending-availability'));
  }
});

test('six millimetres is included, thicker bent sheets are blocked', () => {
  assert.equal(getBendingRestriction('steel-raw', 6), null);
  assert.ok(getBendingRestriction('steel-raw', 8));
  const state = { ...createDefaultProject(), thickness: 8 };
  assert.ok(checkSheetMetalFeasibility(state).checks.some(c => c.id === 'bending-availability' && c.status === 'fail'));
  assert.ok(!checkSheetMetalFeasibility({ ...state, bendCount: 0 }).checks.some(c => c.id === 'bending-availability'));
});

test('catalogue filters all families according to the selected bend count', () => {
  for (const material of ['Steel', 'Aluminum', 'Stainless'] as const) {
    for (const bends of [0, 1, 2, 3, 4]) {
      for (const finish of getAvailableSheetFinishes(material, bends)) {
        assert.ok(getAvailableSheetThicknesses(finish, bends).length > 0);
        if (bends > 0) assert.ok(getAvailableSheetThicknesses(finish, bends).every(t => t <= 6 && !getBendingRestriction(finish, t)));
      }
    }
  }
  assert.ok(getAvailableSheetFinishes('Stainless', 0).includes('stainless-mirror'));
  assert.ok(!getAvailableSheetFinishes('Stainless', 1).includes('stainless-mirror'));
  assert.deepEqual(getAvailableSheetThicknesses('aluminum-anodized', 1), []);
  assert.ok(getAvailableSheetThicknesses('steel-raw', 0).includes(20));
});

test('adding bends adapts incompatible choices and preserves geometry and holes', () => {
  const state = { ...createDefaultProject(), bendCount: 0, thickness: 20 };
  const bent = normalizeBendingSelection(state, 2);
  assert.equal(bent.thickness, 6);
  assert.equal(bent.bendCount, 2);
  assert.equal(bent.legs, state.legs);
  assert.equal(bent.bends, state.bends);
  const mirror = normalizeBendingSelection({ ...state, material: 'Stainless', finish: 'stainless-mirror', thickness: 1.5 }, 1);
  assert.equal(mirror.finish, 'stainless-brushed');
  assert.equal(mirror.thickness, 1.5);
  assert.equal(normalizeBendingSelection(state, 0).thickness, 20);
});
