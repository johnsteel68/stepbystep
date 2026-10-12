import assert from 'node:assert/strict';
import test from 'node:test';
import { existsSync } from 'node:fs';
import { TEXTURE_SETS, FINISH_TEXTURE_PROFILES } from '../viewer/materials/textureCatalog.ts';

test('raw steel uses the replacement Blender maps without changing stainless', () => {
  assert.equal(FINISH_TEXTURE_PROFILES['steel-raw'].set, 'blendRawSteel');
  assert.equal(FINISH_TEXTURE_PROFILES['stainless-raw'].set, 'inoxRawPbr');
  assert.equal(TEXTURE_SETS.blendRawSteel.tileSize, 1500);
});

test('mirror polishing belongs to the upper face only and has no surface relief', () => {
  const mirror = FINISH_TEXTURE_PROFILES['stainless-mirror'];
  assert.equal(mirror.mirrorFace, true);
  assert.equal(mirror.oneSidedRelief, true);
  assert.ok(mirror.roughness < 0.05);
  assert.equal(mirror.metalness, 1);
  assert.equal(mirror.bumpScale, 0);
  assert.equal(mirror.normalScale, 0);
});

test('inox cuir uses the reference-derived relief rather than procedural dots or brushing', () => {
  const profile = FINISH_TEXTURE_PROFILES['stainless-leather'];
  assert.equal(profile.set, 'leatherStainless');
  assert.equal(profile.oneSidedRelief, true);
  assert.equal(profile.normalScale, 0);
  assert.equal(TEXTURE_SETS.leatherStainless.tileSize, 100);
  assert.ok(existsSync(new URL('../public/textures/stainless-leather/leather-reference.jpg', import.meta.url)));
  assert.ok(existsSync(new URL('../public' + TEXTURE_SETS.leatherStainless.height, import.meta.url)));
});

test('every material finish references an existing complete texture set', () => {
  assert.equal(Object.keys(FINISH_TEXTURE_PROFILES).length, 19);
  for (const [finish, profile] of Object.entries(FINISH_TEXTURE_PROFILES)) {
    const set = TEXTURE_SETS[profile.set];
    assert.ok(set.tileSize > 0, finish);
    for (const [map, path] of Object.entries(set)) {
      if (typeof path !== 'string') continue;
      assert.ok(existsSync(new URL('../public' + path, import.meta.url)), finish + ': ' + map + ' ' + path);
    }
  }
});
