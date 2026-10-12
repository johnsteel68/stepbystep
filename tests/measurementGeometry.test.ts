import assert from 'node:assert/strict';
import test from 'node:test';
import { BoxGeometry, Vector3 } from 'three';
import { featureDistance, meshFeatures, type MeasureFeature } from '../viewer/annotations/measurementGeometry.ts';

const point = (x: number, y: number, z = 0): MeasureFeature => ({ id: 'point', kind: 'hole', a: new Vector3(x, y, z), label: 'Centre' });
const edge = (a: number[], b: number[]): MeasureFeature => ({ id: 'edge', kind: 'edge', a: new Vector3(...a as [number, number, number]), b: new Vector3(...b as [number, number, number]), label: 'Arête' });
const distance = (a: MeasureFeature, b: MeasureFeature) => { const pair = featureDistance(a, b); return pair[0].distanceTo(pair[1]); };
test('hole centres and corners measure exact model distance', () => {
  assert.equal(distance(point(0, 0), point(3, 4)), 5);
});
test('hole to edge projects perpendicularly and clamps to finite border', () => {
  assert.equal(distance(point(5, 3), edge([0, 0, 0], [10, 0, 0])), 3);
  assert.equal(distance(point(13, 4), edge([0, 0, 0], [10, 0, 0])), 5);
});
test('parallel edges measure the shortest gap, not arbitrary clicked points', () => {
  assert.equal(distance(edge([0, 0, 0], [100, 0, 0]), edge([20, 8, 0], [90, 8, 0])), 8);
});
test('skew edges use interior closest points', () => {
  assert.equal(distance(edge([-10, 0, 0], [10, 0, 0]), edge([0, -10, 3], [0, 10, 3])), 3);
});
test('mesh recognition yields physical box corners and edges, not triangles', () => {
  const geometry = new BoxGeometry(100, 100, 3), features = meshFeatures(geometry);
  assert.equal(features.filter(item => item.kind === 'edge').length, 12);
  assert.equal(features.filter(item => item.kind === 'corner').length, 8);
  geometry.dispose();
});
