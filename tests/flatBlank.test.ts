import assert from 'node:assert/strict';
import { before, test } from 'node:test';
import { createRequire } from 'node:module';
import initOpenCascade from 'replicad-opencascadejs';
import { getOC, measureVolume, setOC, importSTEP, isShape3D } from 'replicad';
import { BLANK_SHAPES, blankProjection, blankArea } from '../blankGeometry.ts';
import { selectFlatBlankShape, pointInsideFlatBlank, flatBlankDefinition } from '../flatBlank.ts';
import { createFlatBlankSolid } from '../flatBlankCad.ts';
import { createFlatBlankGeometry } from '../viewer/geometry/flatBlank.ts';
import { createFlatDrawingModel } from '../technicalDrawing.ts';
import { createDefaultProject } from '../projectDefaults.ts';
import { exportStepAp214 } from '../stepExport.ts';

const require = createRequire(import.meta.url);
test('adjustable star exports a matching valid CAD and STEP solid', async () => {
  const state = { ...createDefaultProject(), bendCount: 0, blankShape: 'star' as const, blankLength: 100, blankWidth: 100,
    blankBranchCount: 8, blankBranchHeight: 15 };
  const solid = createFlatBlankSolid(state);
  const check = new (getOC().BRepCheck_Analyzer)(solid.wrapped, true, false, false);
  assert.equal(check.IsValid(), true);
  const restored = await importSTEP(new Blob([exportStepAp214(solid)]));
  assert.ok(isShape3D(restored));
  assert.ok(Math.abs(measureVolume(solid) - blankArea(flatBlankDefinition(state)) * state.thickness) < .01);
  assert.ok(Math.abs(measureVolume(restored) - measureVolume(solid)) < .01);
  const mesh = createFlatBlankGeometry(state, true);
  assert.equal(createFlatDrawingModel(state).outline.length, 16);
  mesh.dispose(); check.delete(); restored.delete(); solid.delete();
});
test('custom gear with bore exports a valid STEP solid with matching area', async () => {
  const state = { ...createDefaultProject(), bendCount: 0, blankShape: 'gear' as const, blankLength: 100, blankWidth: 100,
    blankToothCount: 24, blankToothHeight: 10, blankInnerDiameter: 20 };
  const solid = createFlatBlankSolid(state);
  const restored = await importSTEP(new Blob([exportStepAp214(solid)]));
  assert.ok(isShape3D(restored));
  assert.ok(Math.abs(measureVolume(solid) - blankArea(flatBlankDefinition(state)) * state.thickness) < .01);
  assert.ok(Math.abs(measureVolume(restored) - measureVolume(solid)) < .01);
  const mesh = createFlatBlankGeometry(state, true);
  assert.equal(createFlatDrawingModel(state).innerContours?.length, 1);
  mesh.dispose(); restored.delete(); solid.delete();
});
before(async () => setOC(await initOpenCascade({ locateFile: () => require.resolve('replicad-opencascadejs/wasm') })));
for (const { id } of BLANK_SHAPES) test(`flat ${id}: closed CAD solid, matching mesh and PDF contour`, async () => {
  const initial = createDefaultProject();
  initial.bendCount = 0; initial.width = 100; initial.legs[0].length = 150;
  const state = selectFlatBlankShape(initial, id);
  const solid = createFlatBlankSolid(state);
  const check = new (getOC().BRepCheck_Analyzer)(solid.wrapped, true, false, false);
  assert.equal(check.IsValid(), true, id);
  assert.ok(measureVolume(solid) > 0);
  const restored = await importSTEP(new Blob([exportStepAp214(solid)]));
  assert.ok(isShape3D(restored));
  assert.ok(Math.abs(measureVolume(restored) - measureVolume(solid)) < .01);
  const geometry = createFlatBlankGeometry(state, true);
  geometry.computeBoundingBox();
  const bounds = geometry.boundingBox!;
  const definition = flatBlankDefinition(state);
  const x = blankProjection(definition, { x: 1, y: 0 }), z = blankProjection(definition, { x: 0, y: 1 });
  assert.ok(Math.abs(bounds.max.x - x.max) < .01);
  assert.ok(Math.abs(bounds.max.z - z.max) < .01);
  assert.ok(Math.abs(measureVolume(solid) - blankArea(definition) * state.thickness) < .01);
  assert.ok(Math.abs(bounds.max.y - state.thickness / 2) < .01);
  assert.ok(geometry.groups.some(group => group.materialIndex === 1));
  const drawing = createFlatDrawingModel(state);
  assert.ok(Math.abs(Math.max(...drawing.outline.map(p => p.x)) - (x.max - x.min)) < .01);
  assert.ok(Math.min(...drawing.outline.map(p => p.x)) >= -.01);
  geometry.dispose(); check.delete(); restored.delete(); solid.delete();
});

test('centres outside a disc are rejected even inside its bounding rectangle', () => {
  const state = selectFlatBlankShape({ ...createDefaultProject(), bendCount: 0 }, 'circle');
  assert.equal(pointInsideFlatBlank(state, 1, 1), false);
  assert.equal(pointInsideFlatBlank(state, state.width / 2, state.width / 2), true);
});
