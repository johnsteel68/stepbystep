import assert from 'node:assert/strict';
import test from 'node:test';
import { PerspectiveCamera, Vector3 } from 'three';
import { perspectiveDepthRange } from '../viewer/camera/depthRange.ts';

function depthSeparation(distance: number, thickness: number, near: number, far: number) {
  const camera = new PerspectiveCamera(45, 1, near, far);
  const front = new Vector3(0, 0, -distance + thickness / 2).project(camera).z;
  const back = new Vector3(0, 0, -distance - thickness / 2).project(camera).z;
  // Convert NDC to the 24-bit depth buffer used by ordinary WebGL contexts.
  return Math.abs(front - back) / 2 * (2 ** 24 - 1);
}

test('thin sheets keep distinct depths at close, normal and maximum framing distances', () => {
  for (const [distance, span] of [[20, 30], [150, 100], [2500, 1200], [15000, 2980]]) {
    const range = perspectiveDepthRange(distance, span);
    assert.ok(range.near < distance * 0.02, 'close zoom must remain available');
    assert.ok(range.far > distance + span, 'far side of model must remain visible');
    assert.ok(depthSeparation(distance, 1, range.near, range.far) > 8,
      `front/back faces must stay separated at ${distance} mm`);
  }
});

test('customer credence regression improves depth precision by over two orders of magnitude', () => {
  const old = depthSeparation(3000, 1.5, 0.1, 30000);
  const range = perspectiveDepthRange(3000, 1200);
  const next = depthSeparation(3000, 1.5, range.near, range.far);
  assert.ok(old < 1, 'old camera cannot reliably distinguish the two faces');
  assert.ok(next > 80 && next > old * 100);
});
