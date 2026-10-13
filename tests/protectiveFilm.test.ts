import assert from 'node:assert/strict';
import test from 'node:test';
import { MeshPhysicalMaterial, ShaderLib, UniformsUtils, Vector3 } from 'three';
import { createDefaultProject } from '../projectDefaults.ts';
import { generateSheetProfile, createOneSidedTreadGeometry } from '../sheetGeometry.ts';
import { FINISH_TEXTURE_PROFILES } from '../viewer/materials/textureCatalog.ts';
import { filmPeelCorner, createFilmPeelGeometry, applyProtectiveFilm } from '../viewer/materials/protectiveFilm.ts';

const filmed = () => ({ ...createDefaultProject(), material: 'Aluminum' as const, finish: 'aluminum-filmed' as const });
const peelFor = (state: ReturnType<typeof filmed>) => filmPeelCorner(state, generateSheetProfile(state).legTransforms);

test('film is opt-in and assigned only to the finishing face', () => {
  const profile = FINISH_TEXTURE_PROFILES['aluminum-filmed'];
  assert.ok(profile.protectiveFilm && profile.oneSidedRelief);
  assert.ok(Object.entries(FINISH_TEXTURE_PROFILES).every(([id, p]) => id === 'aluminum-filmed' || !p.protectiveFilm));
  const state = filmed(), before = JSON.stringify(state), data = generateSheetProfile(state);
  const geometry = createOneSidedTreadGeometry(data.shape, state.width, data.treadFaceEdges);
  try {
    assert.ok([0, 1, 2].every(index => geometry.groups.some(group => group.materialIndex === index)));
    const peel = peelFor(state)!;
    assert.ok(peel);
    assert.equal(JSON.stringify(state), before, 'cosmetic film cannot modify manufactured dimensions');
    assert.equal(filmPeelCorner(createDefaultProject(), data.legTransforms), undefined);
  } finally { geometry.dispose(); }
});

test('curled corner stays on the finishing side and within the free wing', () => {
  for (const bendCount of [0, 1, 3, 4]) for (const width of [20, 300, 1480]) {
    const state = { ...filmed(), bendCount, width };
    const peel = peelFor(state)!;
    assert.ok(peel.size <= width * .22);
    const geometry = createFilmPeelGeometry(peel);
    try {
      const positions = geometry.getAttribute('position');
      for (let i = 0; i < positions.count; i++) {
        const local = new Vector3().fromBufferAttribute(positions, i).sub(peel.origin);
        assert.ok(local.dot(peel.normal) >= .05999);
        assert.ok(local.dot(peel.along) >= -1e-5 && local.dot(peel.along) <= peel.size + 1e-5);
        assert.ok(local.dot(peel.across) >= -1e-5 && local.dot(peel.across) <= peel.size + 1e-5);
      }
    } finally { geometry.dispose(); }
  }
});

test('holes, corner radii and too-small wings do not get covered by the peeled detail', () => {
  const state = filmed();
  state.legs[0] = { ...state.legs[0], hasHole: true, holeDiam: 10, holePositions: [{ dist: 15, offset: 15, diam: 10, shape: 'round' }] };
  assert.equal(peelFor(state)!.across.z, -1, 'choose the other free corner');
  state.legs[0].holePositions!.push({ dist: 15, offset: 285, diam: 10, shape: 'round' });
  assert.equal(peelFor(state), undefined);
  state.legs[0].hasHole = false;
  state.cornerRadii = { startLeft: 10, startRight: 10, endLeft: 10, endRight: 10 };
  assert.equal(peelFor(state), undefined);
  assert.equal(peelFor({ ...filmed(), width: 10 }), undefined);
});

test('film shader keeps the base metal, replaces only the covered finish and has stable shader caching', () => {
  const material = new MeshPhysicalMaterial();
  const state = filmed(), peel = peelFor(state)!;
  const shader = { vertexShader: ShaderLib.physical.vertexShader, fragmentShader: ShaderLib.physical.fragmentShader,
    uniforms: UniformsUtils.clone(ShaderLib.physical.uniforms) };
  try {
    applyProtectiveFilm(material, peel);
    material.onBeforeCompile(shader as any, {} as any);
    assert.equal(shader.uniforms.filmSize.value, peel.size);
    assert.match(shader.vertexShader, /vFilmPosition = position/);
    assert.match(shader.fragmentShader, /filmU \+ filmV < filmSize/);
    assert.match(shader.fragmentShader, /metalnessFactor = mix\(metalnessFactor, 0.0, filmCover\)/);
    assert.match(shader.fragmentShader, /filmBubble/);
    assert.match(shader.fragmentShader, /abs\(filmDet\) > /);
    assert.equal(material.customProgramCacheKey(), 'protective-film-v1');
    assert.ok(shader.fragmentShader.includes('#include <map_fragment>'));
  } finally { material.dispose(); }
});
