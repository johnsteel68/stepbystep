import assert from 'node:assert/strict';
import test from 'node:test';
import { fitsSheetFormat, checkSheetMetalFeasibility } from '../sheetGeometry.ts';
import { createDefaultProject } from '../projectDefaults.ts';
import { normalizeFormedBlank } from '../formedBlank.ts';

test('stock format accepts both orientations, not two long sides or nonfinite values', () => {
  for (const [length, width] of [[2980,1480], [1480,2980], [1480,1480]]) assert.equal(fitsSheetFormat(length,width), true);
  for (const [length, width] of [[59800,5980], [2980,1481], [2981,1480], [1500,1500], [NaN,100], [100,Infinity]]) assert.equal(fitsSheetFormat(length,width), false);
});
test('normalized flat shapes cannot evade manufacturing format checks', () => {
  for (const shape of ['rectangle','square','circle','semicircle','hexagon','octagon','star','gear','washer','frame','mounting-plate'] as const) {
    const state = normalizeFormedBlank({ ...createDefaultProject(), bendCount: 0, blankShape: shape, blankLength: 5980, blankWidth: 5980 });
    assert.ok(checkSheetMetalFeasibility(state).checks.some(check => check.id === 'sheet_format' && check.status === 'fail'), shape);
  }
});
