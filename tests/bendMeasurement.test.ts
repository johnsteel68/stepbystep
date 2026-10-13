import assert from 'node:assert/strict';
import test from 'node:test';
import { Vector3 } from 'three';
import { createDefaultProject } from '../projectDefaults.ts';
import { generateSheetProfile } from '../sheetGeometry.ts';
import { bendMeasurementReferences } from '../viewer/annotations/bendMeasurement.ts';
import { featureDistance, type MeasureFeature } from '../viewer/annotations/measurementGeometry.ts';

test('each bend exposes inner and outer tangents on both wings, across the real width', () => {
  for (const signedAngle of [-135, -90, -45, 45, 90, 135]) {
    const state = createDefaultProject();
    state.bends[0].angle = signedAngle;
    const refs = bendMeasurementReferences(state, generateSheetProfile(state).legTransforms);
    assert.equal(refs.length, 4);
    assert.equal(new Set(refs.map(ref => ref.id)).size, 4);
    for (const ref of refs) {
      assert.equal(new Vector3(...ref.a).distanceTo(new Vector3(...ref.b)), state.width);
      assert.match(ref.label, /Pli 1 · (intérieur|extérieur) · aile [AB]/);
    }
    for (let end = 0; end < 2; end++) {
      const feature = (index: number): MeasureFeature => ({ ...refs[index], kind: 'bend', a: new Vector3(...refs[index].a), b: new Vector3(...refs[index].b) });
      const [a, b] = featureDistance(feature(end), feature(end + 2));
      assert.ok(Math.abs(a.distanceTo(b) - state.thickness) < 1e-8);
    }
  }
});

test('flat sheets have no bend references and inactive bends are excluded', () => {
  const state = createDefaultProject();
  for (const count of [0, 3, 4]) {
    state.bendCount = count;
    assert.equal(bendMeasurementReferences(state, generateSheetProfile(state).legTransforms).length, count * 4);
  }
});
