import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as THREE from 'three';
import { createDefaultProject } from '../projectDefaults.ts';
import { normalizeFormedBlank, blankBendPlan, blankHoleAllowed } from '../formedBlank.ts';
import { createFormedBlankGeometry } from '../viewer/geometry/formedBlank.ts';
import { createWorkflow } from '../workflow.ts';
import { blankArea } from '../blankGeometry.ts';
import { flatBlankDefinition } from '../flatBlank.ts';

test('shape selection is offered only for zero bends', () => {
  const initial = createDefaultProject();
  for (const bendCount of [1, 2, 3, 4]) {
    const restored = normalizeFormedBlank({ ...initial, bendCount, blankShape: 'star', blankLength: 100, blankWidth: 100 });
    assert.equal(restored.blankShape, undefined);
    assert.equal(restored.blankLength, undefined);
    assert.equal(createWorkflow(restored).some(page => page.section === 10), false);
  }
  assert.equal(createWorkflow({ ...initial, bendCount: 0 }).some(page => page.section === 10), true);
  assert.throws(() => blankBendPlan({ ...initial, blankShape: 'circle' }), /sans pli/);
});

for (const blankShape of ['star', 'washer', 'gear'] as const) test(`flat ${blankShape}: visible face respects concavity and inner opening`, () => {
  const state = normalizeFormedBlank({ ...createDefaultProject(), bendCount: 0, blankShape, blankLength: 100, blankWidth: 100, blankInnerDiameter: blankShape === 'washer' ? 40 : undefined });
  const geometry = createFormedBlankGeometry(state, true);
  const positions = geometry.getAttribute('position'), normals = geometry.getAttribute('normal');
  let area = 0;
  const vertex = (i: number) => new THREE.Vector3().fromBufferAttribute(positions, i);
  for (let i = 0; i < positions.count; i += 3) if (normals.getY(i) > .9) {
    area += vertex(i + 1).sub(vertex(i)).cross(vertex(i + 2).sub(vertex(i))).length() / 2;
  }
  assert.ok(Math.abs(area - blankArea(flatBlankDefinition(state))) < .3);
  if (blankShape === 'washer') {
    assert.equal(blankHoleAllowed(state, 0, 50, 50, 2.5, 2.5), false);
    assert.equal(blankHoleAllowed(state, 0, 15, 50, 2.5, 2.5), true);
  }
  geometry.dispose();
});
