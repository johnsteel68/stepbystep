import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeTextRotation, rotateTextPoint, rotateStencilCuts } from '../textRotation.ts';
import { cornerTextRotation } from '../components/textRotationGesture.ts';
import { stencilCells, textMinimumHeight, applyStencilText, stencilTextIssue, STENCIL_FONTS } from '../stencilText.ts';
import { createDefaultProject } from '../projectDefaults.ts';
import { createProjectLink, readProjectFromUrl, validateSharedProject } from '../projectSharing.ts';
import { createDrawingModel } from '../technicalDrawing.ts';
import type { HolePosition } from '../sheetGeometry.ts';

const radians = (degrees: number) => degrees * Math.PI / 180;
test('45 degree buttons complete a real full turn in both directions', () => {
  let angle = 0;
  const forward: number[] = [], backward: number[] = [];
  for (let i = 0; i < 8; i++) { angle = normalizeTextRotation(angle + 45); forward.push(angle); }
  for (let i = 0; i < 8; i++) { angle = normalizeTextRotation(angle - 45); backward.push(angle); }
  assert.deepEqual(forward, [45, 90, 135, 180, 225, 270, 315, 0]);
  assert.deepEqual(backward, [315, 270, 225, 180, 135, 90, 45, 0]);
  for (const bad of [NaN, Infinity, -Infinity]) assert.throws(() => normalizeTextRotation(bad));
});
test('corner handle rotates freely, crosses the angular seam and snaps only with Shift', () => {
  assert.equal(cornerTextRotation(0, 0, radians(37)), 37);
  assert.equal(cornerTextRotation(0, 0, radians(37), true), 45);
  assert.equal(cornerTextRotation(90, 0, radians(-135)), 315);
  assert.equal(cornerTextRotation(0, radians(179), radians(-179)), 2);
  assert.equal(cornerTextRotation(0, radians(-179), radians(179)), 358);
});

function outline(cut: HolePosition) {
  return (cut.contour ?? [
    { x: -(cut.length ?? cut.diam!) / 2, y: -(cut.width ?? cut.diam!) / 2 },
    { x: (cut.length ?? cut.diam!) / 2, y: -(cut.width ?? cut.diam!) / 2 },
    { x: (cut.length ?? cut.diam!) / 2, y: (cut.width ?? cut.diam!) / 2 },
    { x: -(cut.length ?? cut.diam!) / 2, y: (cut.width ?? cut.diam!) / 2 },
  ]).map(point => ({ x: point.x + cut.dist, y: point.y + cut.offset }));
}
const area = (cut: HolePosition) => cut.shape === 'round' ? Math.PI * (cut.diam! / 2) ** 2
  : Math.abs(outline(cut).reduce((sum, point, index, all) => {
    const next = all[(index + 1) % all.length]; return sum + point.x * next.y - next.x * point.y;
  }, 0)) / 2;

test('all stencil families preserve their actual cut area over eight orientations and a free angle', () => {
  for (const font of STENCIL_FONTS) {
    const config = { text: 'R1', font: font.id, height: textMinimumHeight(2, font.id), x: 0, y: 0, rotation: 0 };
    const cuts = stencilCells(config, 2);
    const expectedArea = cuts.reduce((sum, cut) => sum + area(cut), 0);
    for (const rotation of [45, 90, 135, 180, 225, 270, 315, 360, 37]) {
      const rotated = stencilCells({ ...config, rotation }, 2);
      assert.ok(Math.abs(rotated.reduce((sum, cut) => sum + area(cut), 0) - expectedArea) < .00001, `${font.id}/${rotation}: no stretching or mirrored cutout`);
      assert.ok(rotated.every(cut => Number.isFinite(cut.dist) && Number.isFinite(cut.offset)));
    }
  }
});
test('an oblique rectangle rotates its four corners, not just its bounding box', () => {
  const original: HolePosition = { dist: 30, offset: 20, length: 12, width: 4, shape: 'rect', textCutout: true };
  const rotated = rotateStencilCuts([original], 45, 10, 10)[0];
  assert.ok(rotated.contour);
  const expected = outline(original).map(point => {
    const local = rotateTextPoint(point.x - 10, point.y - 10, 45);
    return { x: local.x + 10, y: local.y + 10 };
  });
  outline(rotated).forEach((point, index) => {
    assert.ok(Math.abs(point.x - expected[index].x) < 1e-9);
    assert.ok(Math.abs(point.y - expected[index].y) < 1e-9);
  });
  assert.ok(Math.abs(area(rotated) - 48) < 1e-8);
});
test('full and free angles survive both wings, PDF and shared links without a mirrored letter', () => {
  const state = { ...createDefaultProject(), thickness: 2 };
  for (const legId of ['A', 'B']) for (const rotation of [0, 45, 90, 135, 180, 225, 270, 315, 37]) {
    const config = { text: 'R1', font: 'stencil-micro-tech' as const, height: 16, x: 150, y: 150, rotation };
    const saved = applyStencilText(state, legId, config);
    assert.equal(stencilTextIssue(saved, legId), null);
    const shared = readProjectFromUrl(createProjectLink(saved, 'length'))!.state;
    assert.equal(shared.legs.find(leg => leg.id === legId)!.cutText!.rotation, rotation);
    assert.equal(stencilTextIssue(shared, legId), null);
    assert.ok(createDrawingModel(shared).wings.find(wing => wing.leg.id === legId)!.holes.length);
    const draft = stencilCells(config, 2);
    saved.legs.find(leg => leg.id === legId)!.holePositions!.forEach((cut, index) => assert.deepEqual(cut.contour, draft[index].contour));
  }
  assert.throws(() => validateSharedProject({ state: { ...state, legs: state.legs.map((leg, i) => i ? leg : { ...leg, cutText: { text: 'R', height: 16, x: 150, y: 150, rotation: '45' } }) }, grainDirection: 'length' }));
});
test('rotation keeps edge and bend protection; invalid angles never become committed cuts', () => {
  const state = { ...createDefaultProject(), thickness: 2 };
  const config = { text: 'TEXT', font: 'stencil-micro-block' as const, height: 16, x: 150, y: 150, rotation: 45 };
  assert.throws(() => applyStencilText(state, 'A', { ...config, x: 1 }), /marge|pli/);
  assert.throws(() => applyStencilText(state, 'A', { ...config, x: 290 }), /marge|pli|pièce/);
  assert.throws(() => stencilCells({ ...config, rotation: NaN }, 2), /invalide/);
});
