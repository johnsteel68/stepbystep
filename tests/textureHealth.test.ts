import assert from 'node:assert/strict';
import test from 'node:test';
import { getNeutralTexturePixel, getTextureFailureCount, reportTextureFailure, subscribeTextureHealth } from '../viewer/materials/textureHealth.ts';

test('failed normal maps are replaced by a neutral normal, not a white colour', () => {
  assert.deepEqual(getNeutralTexturePixel('/normal_opengl.webp'), [128, 128, 255, 255]);
  assert.deepEqual(getNeutralTexturePixel('/Displacement.jpg'), [128, 128, 128, 255]);
  assert.deepEqual(getNeutralTexturePixel('/Roughness.jpg'), [255, 255, 255, 255]);
  assert.deepEqual(getNeutralTexturePixel('/Opacity.png'), [255, 255, 255, 255]);
});

test('texture failures notify once per asset and subscriptions clean up', () => {
  let calls = 0;
  const baseline = getTextureFailureCount();
  const unsubscribe = subscribeTextureHealth(() => calls++);
  reportTextureFailure('/test-map-a.jpg');
  reportTextureFailure('/test-map-a.jpg');
  assert.equal(calls, 1);
  assert.equal(getTextureFailureCount(), baseline + 1);
  unsubscribe();
  reportTextureFailure('/test-map-b.jpg');
  assert.equal(calls, 1);
});
