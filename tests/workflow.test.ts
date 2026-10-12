import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as THREE from 'three';
import { Brush, Evaluator, SUBTRACTION } from 'three-bvh-csg';
import { createWorkflow, workflowPageStatus } from '../workflow.ts';
import { resizeDraftHole, explicitHoles, saveHoles, holeSeries, clearAllHoles } from '../holeEditing.ts';
import { applyContinuousSideUvs, checkSheetMetalFeasibility, constrainHolePosition, createOneSidedTreadGeometry, generateSheetProfile, getBendArcSegments, getFlatCornerEnds, getHoleConstraints, getMinLegLength, getPatternPositions, type SheetMetalState } from '../sheetGeometry.ts';

function fixture(bendCount = 1): SheetMetalState {
  return {
    bendCount, width: 60, thickness: 3, material: 'Steel',
    legs: ['A', 'B', 'C', 'D', 'E'].map(id => ({
      id, label: `Aile ${id}`, length: 100, hasHole: false,
      holeDiam: 10, holeDist: 25, holeOffset: 25,
    })),
    bends: ['1', '2', '3', '4'].map(id => ({ id, angle: 90, direction: 1 })),
  };
}

test('saving holes rejects bend crossings including a single unsafe member of a series', () => {
  const state = fixture(2);
  assert.equal(saveHoles(state, 'A', [{ dist: 99, offset: 25, diam: 5 }]), state);
  assert.equal(saveHoles(state, 'B', [{ dist: 1, offset: 25, diam: 5 }]), state);
  assert.equal(saveHoles(state, 'B', [{ dist: 30, offset: 25, diam: 5 }, { dist: 90, offset: 25, diam: 30 }]), state);
  assert.notEqual(saveHoles(state, 'A', [{ dist: 1, offset: 25, diam: 5 }]), state);
  const flat = fixture(0);
  assert.notEqual(saveHoles(flat, 'A', [{ dist: 99, offset: 25, diam: 5 }]), flat);
});

test('thin sheets protect the complete displayed fold zone', () => {
  const state = { ...fixture(2), thickness: 1 };
  assert.equal(saveHoles(state, 'A', [{ dist: 94, offset: 25, diam: 5 }]), state);
  assert.equal(saveHoles(state, 'B', [{ dist: 6, offset: 25, diam: 5 }]), state);
  assert.notEqual(saveHoles(state, 'B', [{ dist: 40, offset: 25, diam: 5 }]), state);
});

test('Bend arcs use enough segments to render smooth curves', () => {
  assert.equal(getBendArcSegments(Math.PI / 2), 96);
  assert.equal(getBendArcSegments(Math.PI / 4), 48);
  assert.equal(getBendArcSegments(165 * Math.PI / 180), 176);
  assert.equal(getBendArcSegments(4 * Math.PI), 192);
});

for (const bends of [1, 2, 3, 4]) {
  test(`Workflow with ${bends} bends has every control in order`, () => {
    const pages = createWorkflow(fixture(bends));
    assert.equal(pages.length, 10 + bends * 2);
    assert.deepEqual(pages.filter(page => page.section === 5).map(page => page.bendIndex), Array.from({ length: bends }, (_, i) => i));
    assert.deepEqual(pages.filter(page => page.legIndex !== undefined).map(page => page.legIndex), Array.from({ length: bends + 1 }, (_, i) => i));
    assert.equal(pages.filter(page => page.width).length, 1);
    assert.deepEqual(pages.slice(-4).map(page => page.title), ['Arrondis des coins', 'Texte', 'Trous', 'Commander']);
    assert.deepEqual(pages.slice(0, 4).map(page => page.section), [4, 1, 2, 3]);
    assert.deepEqual(pages.slice(4).filter(page => page.section !== 12).map(page => page.section), [...pages.slice(4).filter(page => page.section !== 12).map(page => page.section)].sort((a, b) => a - b));
  });
}

test('No-bend workflow offers a flat sheet and omits bend and angle pages', () => {
  const pages = createWorkflow(fixture(0));
  assert.equal(pages.length, 10);
  assert.equal(pages[0].title, 'Nombre de plis');
  assert.deepEqual(pages.filter(page => page.section === 5), []);
  assert.deepEqual(pages.slice(0, 3).map(page => page.section), [4, 10, 11]);
  assert.deepEqual(pages.filter(page => page.section === 6), []);
});

test('Every flat shape has a dedicated parameters page before material selection', () => {
  for (const blankShape of ['rectangle', 'star', 'gear', 'frame', 'mounting-plate'] as const) {
    const pages = createWorkflow({ ...fixture(0), blankShape });
    assert.deepEqual(pages.slice(0, 4).map(page => page.title), ['Nombre de plis', 'Forme de la plaque', 'Paramètres de la forme', 'Matière']);
    assert.equal(pages.filter(page => page.section === 11).length, 1);
  }
  assert.equal(createWorkflow(fixture(1)).some(page => page.section === 11), false);
});

test('Guided indicator distinguishes validated, current, problematic and future pages', () => {
  const pages = createWorkflow(fixture(2));
  const current = 5;
  const checks = [
    { id: 'min_leg_B', name: 'Aile B', category: 'bending' as const, status: 'fail' as const, value: '20 mm', criterion: '30 mm', message: 'Aile trop courte' },
    { id: 'hole_size_A', name: 'Trou A', category: 'punching' as const, status: 'warning' as const, value: '2 mm', criterion: '3 mm', message: 'Trou trop petit' },
  ];
  assert.equal(workflowPageStatus(pages[0], 0, current, checks), 'complete');
  assert.equal(workflowPageStatus(pages[current - 1], current - 1, current, checks), 'current');
  const wingBIndex = pages.findIndex(page => page.legId === 'B');
  assert.equal(workflowPageStatus(pages[wingBIndex], wingBIndex, current, checks), 'problem');
  const holesIndex = pages.findIndex(page => page.section === 8);
  assert.equal(workflowPageStatus(pages[holesIndex], holesIndex, current, checks), 'problem');
  const cornersIndex = pages.findIndex(page => page.section === 7);
  assert.equal(workflowPageStatus(pages[cornersIndex], cornersIndex, current, checks), 'upcoming');
});

test('No-bend sheet profile is a valid rectangular plate', () => {
  const profile = generateSheetProfile(fixture(0));
  assert.equal(profile.pathPoints.length, 4);
  assert.equal(profile.edges.length, 4);
  assert.equal(profile.legTransforms.length, 1);
  assert.equal(profile.bounds.maxX - profile.bounds.minX, 100);
  assert.equal(profile.bounds.maxY - profile.bounds.minY, 3);
  assert.equal(profile.collision.hasCollision, false);
});

test('Texture UV follows the unfolded profile continuously across bends', () => {
  const profile = generateSheetProfile(fixture(2));
  const geometry = applyContinuousSideUvs(new THREE.ExtrudeGeometry(profile.shape, { depth: 60, bevelEnabled: false }), profile.shape);
  const positions = geometry.getAttribute('position');
  const uvs = geometry.getAttribute('uv');
  const side = geometry.groups.find(group => group.materialIndex === 1)!;
  const bendPoint = profile.treadFaceEdges[0].p2;
  const bendUvs: number[] = [];
  let maxU = 0;
  for (let vertex = side.start; vertex < side.start + side.count; vertex++) {
    maxU = Math.max(maxU, uvs.getX(vertex));
    if (Math.hypot(positions.getX(vertex) - bendPoint.x, positions.getY(vertex) - bendPoint.y) < 0.001) {
      bendUvs.push(uvs.getX(vertex));
    }
  }
  assert.ok(maxU > 200);
  assert.ok(bendUvs.length >= 2);
  assert.ok(bendUvs.every(value => Math.abs(value - bendUvs[0]) < 0.001));
  geometry.dispose();
});

test('Texture UV does not jump across the closing edge of the profile', () => {
  const profile = generateSheetProfile(fixture(0));
  const geometry = applyContinuousSideUvs(new THREE.ExtrudeGeometry(profile.shape, { depth: 60, bevelEnabled: false }), profile.shape);
  const uvs = geometry.getAttribute('uv');
  const side = geometry.groups.find(group => group.materialIndex === 1)!;
  for (let start = side.start; start < side.start + side.count; start += 6) {
    const values = Array.from({ length: 6 }, (_, offset) => uvs.getX(start + offset));
    assert.ok(Math.max(...values) - Math.min(...values) <= 101, `UV jump on side edge ${start}`);
  }
  geometry.dispose();
});

test('Flat-sheet corner radii map to both separate length ends', () => {
  const state = {
    ...fixture(0),
    cornerRadii: { startLeft: 3, startRight: 4, endLeft: 5, endRight: 6 },
  };
  const profile = generateSheetProfile(state);
  const [start, end] = getFlatCornerEnds(state, profile.legTransforms);

  assert.deepEqual(start.sideRadii, { left: 3, right: 4 });
  assert.deepEqual(end.sideRadii, { left: 5, right: 6 });
  assert.equal(start.legTransform.tip.x, profile.legTransforms[0].bendStart.x);
  assert.equal(end.legTransform.tip.x, profile.legTransforms[0].tip.x);
  assert.notEqual(start.legTransform.tip.x, end.legTransform.tip.x);
  assert.deepEqual(start.legTransform.direction, {
    x: -profile.legTransforms[0].direction.x,
    y: -profile.legTransforms[0].direction.y,
  });
});

test('Flat-sheet hole placement uses both ends as free edges and skips bend checks', () => {
  const state = fixture(0);
  const bounds = getHoleConstraints(state.legs[0], state.thickness, state.width, false);
  assert.equal(bounds.minDist, 0);
  assert.equal(bounds.maxDist, state.legs[0].length);
  assert.deepEqual(constrainHolePosition(state.legs[0], state.width, state.thickness, 100, 60, false), { dist: 100, offset: 60 });
  const report = checkSheetMetalFeasibility(state);
  assert.equal(report.isFeasible, true);
  assert.equal(report.checks.some(check => ['min_legs', 'bend_radius', 'bend_angles'].includes(check.id)), false);
});

test('Interior wings keep bend-safe margins at both folded ends', () => {
  const state = fixture(2);
  const middleWing = state.legs[1];
  const bounds = getHoleConstraints(middleWing, state.thickness, state.width, true, undefined, undefined, undefined, true, true);
  assert.ok(bounds.minDist > 0);
  assert.ok(bounds.maxDist < middleWing.length);
  assert.ok(constrainHolePosition(middleWing, state.width, state.thickness, 0, 25, true, true).dist >= bounds.minDist);
  assert.ok(constrainHolePosition(middleWing, state.width, state.thickness, middleWing.length, 25, true, true).dist <= bounds.maxDist);
});

test('Changing the next hole size preserves existing holes and other wings', () => {
  const state = fixture();
  state.legs[0] = { ...state.legs[0], hasHole: true, holeShape: 'rect', holeLength: 25, holeWidth: 12, holeCornerRadius: 3 };
  const updated = resizeDraftHole(state, 'A', 'holeLength', 32);
  assert.equal(updated.legs[0].holeLength, 32);
  assert.equal(state.legs[0].holeLength, 25);
  assert.equal(updated.legs[1], state.legs[1]);
  const [hole] = getPatternPositions(updated.legs[0], updated.width, undefined, updated.thickness);
  assert.deepEqual(hole, { dist: 25, offset: 25, shape: 'rect', diam: 10, length: 25, width: 12, orientation: 'along_length', cornerRadius: 3 });
});

test('Mixed shapes keep their own dimensions when a new hole is sized', () => {
  const state = fixture();
  state.legs[0] = { ...state.legs[0], hasHole: true, holePositions: [
    { dist: 20, offset: 20, shape: 'round', diam: 8 },
    { dist: 45, offset: 35, shape: 'oblong', length: 28, width: 9, orientation: 'along_width' },
  ] };
  const updated = resizeDraftHole(state, 'A', 'holeDiam', 20);
  assert.equal(updated.legs[0].holeDiam, 20);
  assert.equal(updated.legs[0].holePositions?.[0].diam, 8);
  assert.equal(updated.legs[0].holePositions?.[1].length, 28);
  assert.equal(updated.legs[0].holePositions?.[1].orientation, 'along_width');
});

test('Invalid or oversized draft sizes are handled without adding a hole', () => {
  const state = fixture();
  assert.equal(resizeDraftHole(state, 'A', 'holeDiam', NaN), state);
  const updated = resizeDraftHole(state, 'A', 'holeDiam', 999);
  assert.equal(updated.legs[0].holeDiam, 36);
  assert.equal(updated.legs[0].hasHole, false);
  assert.equal(updated.legs[0].holePositions, undefined);
  assert.equal(resizeDraftHole(state, 'A', 'holeDiam', -2).legs[0].holeDiam, 2);
});

test('Wing length limits never fall below 30 mm', () => {
  for (const thickness of [1, 1.5, 2, 3, 4, 5, 6, 8, 10]) assert.ok(getMinLegLength(thickness) >= 30);
});

for (const bends of [1, 2, 3, 4]) {
  test(`Tread texture is assigned to one sheet face only (${bends} bends)`, () => {
    const profile = generateSheetProfile(fixture(bends));
    const geometry = createOneSidedTreadGeometry(profile.shape, 60, profile.treadFaceEdges);
    const countForMaterial = (materialIndex: number) => geometry.groups
      .filter(group => group.materialIndex === materialIndex)
      .reduce((total, group) => total + group.count, 0);

    assert.equal(countForMaterial(1), profile.treadFaceEdges.length * 6);
    assert.ok(countForMaterial(0) > 0, 'cut edges must stay smooth');
    assert.ok(countForMaterial(2) > 0, 'the reverse face must stay smooth');
    geometry.dispose();
  });
}

test('Flat tread plate stays visible after a hole is cut with one-sided materials', () => {
  const profile = generateSheetProfile(fixture(0));
  const smooth = new THREE.MeshPhysicalMaterial();
  const textured = new THREE.MeshPhysicalMaterial();
  const base = new Brush(
    createOneSidedTreadGeometry(profile.shape, 60, profile.treadFaceEdges),
    [smooth, textured, smooth],
  );
  // Must be a separate material instance from the base, even though it looks
  // the same. Sharing it triggers a missing material-group error in the CSG.
  const cutter = new Brush(new THREE.CylinderGeometry(5, 5, 12, 32), smooth.clone());
  base.position.set(-50, 0, -30);
  cutter.position.set(-25, 0, -5);
  base.updateMatrixWorld(true);
  cutter.updateMatrixWorld(true);

  const evaluator = new Evaluator();
  evaluator.useGroups = true;
  const result = evaluator.evaluate(base, cutter, SUBTRACTION);
  const materials = Array.isArray(result.material) ? result.material : [result.material];

  assert.ok(result.geometry.getAttribute('position').count > 0);
  assert.ok(result.geometry.groups.length > 0);
  assert.ok(result.geometry.groups.every(group => group.materialIndex < materials.length));

  result.geometry.dispose();
  base.geometry.dispose();
  cutter.geometry.dispose();
  const cutterMaterials = Array.isArray(cutter.material) ? cutter.material : [cutter.material];
  new Set([...materials, smooth, textured, ...cutterMaterials]).forEach(material => material.dispose());
});

test('Adding a corner series preserves existing holes and their dimensions', () => {
  const state = saveHoles(fixture(), 'A', [{ dist: 40, offset: 30, shape: 'rect', length: 18, width: 8 }]);
  const original = explicitHoles(state.legs[0], state);
  const series = holeSeries({ ...state.legs[0], holePattern: { mode: 'corners', count: 4, margin: 15, rows: 2, columns: 2 } }, state);
  assert.equal(series.length, 4);
  const updated = saveHoles(state, 'A', series);
  assert.equal(updated.legs[0].holePositions?.length, 5);
  assert.deepEqual(updated.legs[0].holePositions?.[0], original[0]);
});

test('Clear-all holes removes holes and patterns from every wing', () => {
  const state = saveHoles(saveHoles(fixture(), 'A', [{ dist: 40, offset: 30 }]), 'B', [{ dist: 60, offset: 20 }, { dist: 80, offset: 40 }]);
  const cleared = clearAllHoles(state);

  assert.ok(cleared.legs.every(leg => !leg.hasHole && leg.holePositions === undefined));
  assert.ok(cleared.legs.every(leg => explicitHoles(leg, cleared).length === 0));
});

test('Editing one hole preserves every other hole and wing', () => {
  const state = saveHoles(fixture(), 'A', [{ dist: 20, offset: 20, diam: 8 }, { dist: 50, offset: 40, diam: 12 }]);
  const original = explicitHoles(state.legs[0], state);
  const updated = saveHoles(state, 'A', [{ ...original[0], dist: 28, shape: 'square', cornerRadius: 2 }], 0);
  assert.equal(updated.legs[0].holePositions?.[0].dist, 28);
  assert.equal(updated.legs[0].holePositions?.[0].shape, 'square');
  assert.deepEqual(updated.legs[0].holePositions?.[1], original[1]);
  assert.equal(updated.legs[1], state.legs[1]);
});

test('Overcrowded parametric series are rejected', () => {
  const state = fixture();
  const series = holeSeries({ ...state.legs[0], holePattern: { mode: 'line', count: 20, margin: 15, rows: 1, columns: 20 } }, state);
  assert.deepEqual(series, []);
});

test('Interior-wing parametric series reject holes that cannot clear both bends', () => {
  const state = fixture(2);
  const middleWing = { ...state.legs[1], holePattern: { mode: 'line' as const, count: 8, margin: 0, rows: 1, columns: 8 } };
  assert.deepEqual(holeSeries(middleWing, state), []);
});

test('Parametric grid supports more than ten columns', () => {
  const state = fixture();
  const leg = { ...state.legs[0], length: 500, holeDiam: 8 };
  const positions = getPatternPositions(leg, state.width, {
    mode: 'square', count: 16, margin: 15, rows: 1, columns: 16,
  }, state.thickness);

  assert.equal(positions.length, 16);
  assert.equal(positions[0].dist, 15);
  assert.equal(positions.at(-1)?.dist, 485);
});
