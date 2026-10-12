import assert from 'node:assert/strict';
import test from 'node:test';
import { Vector3 } from 'three';
import { orbitPositionAtAngle, orbitAngle } from '../viewer/camera/rotation.ts';

test('camera slider preserves height, target and viewing distance', () => {
  const target = new Vector3(5, 20, -10);
  const position = new Vector3(80, 110, 50);
  for (const angle of [-180, -90, 0, 35, 90, 180]) {
    const rotated = orbitPositionAtAngle(position, target, angle);
    assert.ok(Math.abs(rotated.distanceTo(target) - position.distanceTo(target)) < 1e-8);
    assert.equal(rotated.y, position.y);
    assert.equal(orbitAngle(rotated, target), angle);
  }
  assert.deepEqual(position.toArray(), [80, 110, 50]);
  assert.deepEqual(target.toArray(), [5, 20, -10]);
});
