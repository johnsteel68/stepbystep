import assert from 'node:assert/strict';
import test from 'node:test';
import { MeshPhysicalMaterial, ShaderLib, UniformsUtils, Vector3 } from 'three';
import { createDefaultProject } from '../projectDefaults.ts';
import { generateSheetProfile, createOneSidedTreadGeometry, type SheetMetalState, type SheetFinish } from '../sheetGeometry.ts';
import { FINISH_TEXTURE_PROFILES } from '../viewer/materials/textureCatalog.ts';
import { filmPeelCorner, createFilmPeelGeometry, applyProtectiveFilm, setProtectiveFilmSize, setProtectiveFilmCoverage } from '../viewer/materials/protectiveFilm.ts';

const filmed = () => ({ ...createDefaultProject(), material: 'Aluminum' as const, finish: 'aluminum-filmed' as const });
const peelFor = (state: SheetMetalState) => filmPeelCorner(state, generateSheetProfile(state).legTransforms);
const filmedFinishes: SheetFinish[] = ['aluminum-filmed', 'aluminum-anodized', 'aluminum-antitrace',
  'stainless-brushed', 'stainless-bright', 'stainless-marine-raw', 'stainless-leather'];

test('film is opt-in and assigned only to the finishing face', () => {
  const profile = FINISH_TEXTURE_PROFILES['aluminum-filmed'];
  assert.ok(profile.protectiveFilm && profile.oneSidedRelief);
  assert.deepEqual(Object.entries(FINISH_TEXTURE_PROFILES).filter(([, p]) => p.protectiveFilm).map(([id]) => id).sort(), [...filmedFinishes].sort());
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

test('all seven filmed finishes get film on the finish face and an intact peeled corner', () => {
  for (const finish of filmedFinishes) {
    const profile = FINISH_TEXTURE_PROFILES[finish];
    assert.ok(profile.protectiveFilm && profile.oneSidedRelief, finish);
    const state = { ...createDefaultProject(), finish, material: finish.startsWith('aluminum') ? 'Aluminum' as const : 'Stainless' as const };
    const before = JSON.stringify(state);
    assert.ok(peelFor(state), finish);
    assert.equal(JSON.stringify(state), before);
  }
});

test('curled corner stays on the finishing side and within the free wing', () => {
  for (const bendCount of [0, 1, 3, 4]) for (const width of [20, 300, 1480]) {
    const state = { ...filmed(), bendCount, width };
    const peel = peelFor(state)!;
    assert.ok(peel.size <= width * .4);
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

test('standard wing reveals a substantial material sample and lifts the film visibly', () => {
  const peel = peelFor(filmed())!;
  assert.ok(peel.size >= 100 && peel.size <= 120);
  const geometry = createFilmPeelGeometry(peel);
  try {
    const positions = geometry.getAttribute('position');
    let height = 0;
    for (let i = 0; i < positions.count; i++) {
      height = Math.max(height, new Vector3().fromBufferAttribute(positions, i).sub(peel.origin).dot(peel.normal));
    }
    assert.ok(height > peel.size * .45);
    const raw = FINISH_TEXTURE_PROFILES['aluminum-raw'], filmedProfile = FINISH_TEXTURE_PROFILES['aluminum-filmed'];
    for (const key of ['set', 'roughness', 'metalness', 'normalScale', 'bumpScale'] as const) {
      assert.equal(filmedProfile[key], raw[key], key);
    }
  } finally { geometry.dispose(); }
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
    setProtectiveFilmSize(material, peel.maxSize!);
    assert.equal(shader.uniforms.filmSize.value, peel.maxSize);
    setProtectiveFilmSize(material, peel.size);
    assert.equal(shader.uniforms.filmSize.value, peel.size);
    assert.match(shader.vertexShader, /vFilmPosition = position/);
    assert.match(shader.fragmentShader, /filmU \+ filmV < filmSize/);
    assert.match(shader.fragmentShader, /metalnessFactor = mix\(metalnessFactor, 0.0, filmCover \* 0.55\)/);
    assert.doesNotMatch(shader.fragmentShader, /filmBubble|bubbleUv|filmAir/);
    assert.equal(shader.uniforms.filmOpacity.value, 0, 'bare metal is the default');
    setProtectiveFilmCoverage(material, 1);
    assert.equal(shader.uniforms.filmOpacity.value, 1);
    setProtectiveFilmCoverage(material, 0);
    assert.equal(shader.uniforms.filmOpacity.value, 0);
    assert.equal(material.customProgramCacheKey(), 'protective-film-workflow-v4');
    assert.match(shader.fragmentShader, /mix\(diffuseColor.rgb, vec3\(0.035,0.28,0.68\), 0.3\)/);
    assert.match(shader.fragmentShader, /filmCover \*= filmOpacity/);
    assert.match(shader.fragmentShader, /mix\(normal, filmBaseNormal, filmCover \* 0.6\)/);
    assert.ok(shader.fragmentShader.includes('#include <map_fragment>'));
  } finally { material.dispose(); }
});

test('dragging reuses the flap buffer and returns to the same dog-eared shape', () => {
  const peel = peelFor(filmed())!;
  assert.ok(peel.maxSize! > peel.size && peel.maxSize! <= 298);
  const geometry = createFilmPeelGeometry(peel);
  try {
    const buffer = geometry.getAttribute('position');
    const initial = Array.from(buffer.array);
    createFilmPeelGeometry({ ...peel, size: peel.maxSize! }, geometry);
    assert.equal(geometry.getAttribute('position'), buffer);
    assert.notDeepEqual(Array.from(buffer.array), initial);
    createFilmPeelGeometry(peel, geometry);
    assert.deepEqual(Array.from(buffer.array), initial);
    assert.ok(geometry.boundingSphere && Number.isFinite(geometry.boundingSphere.radius));
  } finally { geometry.dispose(); }
});

test('maximum peel stays within the current wing for dragging and auto-removal', () => {
  for (const bendCount of [0, 1, 3, 4]) {
    for (const [length, width] of [[60, 300], [300, 20], [300, 300], [1200, 1480]]) {
      const state = { ...filmed(), bendCount, width };
      state.legs = state.legs.map(leg => ({ ...leg, length }));
      const profile = generateSheetProfile(state);
      const wing = profile.legTransforms[0];
      const straight = Math.hypot(wing.bendStart.x - wing.tip.x, wing.bendStart.y - wing.tip.y);
      const peel = filmPeelCorner(state, profile.legTransforms)!;
      assert.ok(peel.maxSize! <= Math.min(straight, width) - 2 + 1e-6);
      const geometry = createFilmPeelGeometry({ ...peel, size: peel.maxSize! });
      try {
        const positions = geometry.getAttribute('position');
        for (let i = 0; i < positions.count; i++) {
          const local = new Vector3().fromBufferAttribute(positions, i).sub(peel.origin);
          const along = local.dot(peel.along), across = local.dot(peel.across);
          assert.ok(along >= -1e-4 && along <= straight - 2 + 1e-4);
          assert.ok(across >= -1e-4 && across <= width - 2 + 1e-4);
        }
      } finally { geometry.dispose(); }
    }
  }
});
