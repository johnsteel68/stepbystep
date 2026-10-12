import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { createOblongBufferGeometry, createRoundedRectBufferGeometry, createFlatCornerCutGeometry, createFlatHolePreviewGeometry } from '../viewer/geometry/cutters.ts';
import { numberPreviewCutouts } from '../viewer/annotations/previewCutouts.ts';
import { generateSheetProfile } from '../sheetGeometry.ts';
import { createDefaultProject } from '../projectDefaults.ts';

test('corner previews display text paths without numbering them as holes', () => {
  const previews = numberPreviewCutouts([{ textCutout: true }, {}, { textCutout: true }, { textCutout: false }]);
  assert.deepEqual(previews.map(p => p.number), [undefined, 1, undefined, 2]);
});

test('flat text outlines reverse the downward sheet Y datum, not the letter X direction', () => {
  const contour = [{ x: -4, y: -6 }, { x: 3, y: -6 }, { x: 1, y: 2 }, { x: -4, y: 2 }];
  const leg = { ...createDefaultProject().legs[0], holeContour: contour };
  const geometry = createFlatHolePreviewGeometry(leg, 'rect', 'along_length');
  try {
    const positions = geometry.getAttribute('position');
    for (let i = 0; i < positions.count; i++) {
      assert.ok(contour.some(p => Math.abs(p.x - positions.getX(i)) < 1e-6 && Math.abs(-p.y - positions.getY(i)) < 1e-6));
    }
    geometry.computeBoundingBox();
    assert.equal(geometry.boundingBox!.min.y, -2);
    assert.equal(geometry.boundingBox!.max.y, 6);
    assert.deepEqual(leg.holeContour, contour, 'Preview must not change the exported contours');
  } finally { geometry.dispose(); }
});

test('CSG oblong rotation swaps length and width without becoming circular', () => {
  for (const orientation of ['along_length', 'along_width'] as const) {
    const geometry = createOblongBufferGeometry(30, 8, 3, orientation);
    geometry.computeBoundingBox();
    const size = geometry.boundingBox!.getSize(new THREE.Vector3());
    assert.ok(Math.abs(size.x - (orientation === 'along_length' ? 30 : 8)) < .1);
    assert.ok(Math.abs(size.z - (orientation === 'along_length' ? 8 : 30)) < .1);
    assert.ok(Math.abs(size.y - 12) < .1);
    geometry.dispose();
  }
});

test('rounded rectangle cutter preserves its dimensions after centering', () => {
  const geometry = createRoundedRectBufferGeometry(25, 12, 6, 3);
  geometry.computeBoundingBox();
  const size = geometry.boundingBox!.getSize(new THREE.Vector3());
  assert.ok(Math.abs(size.x - 25) < .1 && Math.abs(size.z - 12) < .1 && Math.abs(size.y - 6) < .1);
  assert.ok(geometry.boundingBox!.getCenter(new THREE.Vector3()).length() < .001);
  geometry.dispose();
});

test('corner cutters stay confined to thickness on both mirrored sides', () => {
  const state = createDefaultProject();
  const transforms = generateSheetProfile(state).legTransforms;
  for (const leg of transforms) for (const side of ['left', 'right'] as const) {
    const geometry = createFlatCornerCutGeometry(12, side, state.thickness, leg);
    const positions = geometry.getAttribute('position');
    for (let index = 0; index < positions.count; index++) {
      const through = positions.getX(index) * leg.normal.x + positions.getY(index) * leg.normal.y;
      assert.ok(Number.isFinite(through));
      assert.ok(Math.abs(through) <= state.thickness / 2 + .101);
    }
    geometry.dispose();
  }
});
