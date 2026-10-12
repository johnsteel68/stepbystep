import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { ResilientTextureLoader } from '../viewer/materials/ResilientTextureLoader.ts';

test('missing texture resolves a neutral fallback instead of rejecting the whole scene', () => {
  const original = THREE.TextureLoader.prototype.load;
  try {
    THREE.TextureLoader.prototype.load = function(_url, _onLoad, _onProgress, onError) {
      onError?.(new Error('404'));
      return new THREE.Texture<HTMLImageElement>();
    };
    let loaded: THREE.Texture | undefined;
    new ResilientTextureLoader().load('/missing-normal.jpg', texture => { loaded = texture; });
    assert.ok(loaded instanceof THREE.DataTexture);
    assert.deepEqual(Array.from(loaded.image.data), [128, 128, 255, 255]);
    loaded.dispose();
  } finally { THREE.TextureLoader.prototype.load = original; }
});

test('successful texture is forwarded unchanged', () => {
  const original = THREE.TextureLoader.prototype.load;
  const realTexture = new THREE.Texture<HTMLImageElement>();
  try {
    THREE.TextureLoader.prototype.load = function(_url, onLoad) { onLoad?.(realTexture); return realTexture; };
    let loaded: THREE.Texture | undefined;
    assert.equal(new ResilientTextureLoader().load('/valid.jpg', texture => { loaded = texture; }), realTexture);
    assert.equal(loaded, realTexture);
  } finally { THREE.TextureLoader.prototype.load = original; realTexture.dispose(); }
});
