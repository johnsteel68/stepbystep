import assert from 'node:assert/strict';
import test from 'node:test';
import { COMPACT_STENCIL_FONTS } from '../compactStencil.ts';
import { applyStencilText, stencilCells, textMinimumHeight, stencilTextIssue } from '../stencilText.ts';
import { createDefaultProject } from '../projectDefaults.ts';
import { createProjectLink, readProjectFromUrl } from '../projectSharing.ts';
import { createDrawingModel } from '../technicalDrawing.ts';

for (const font of COMPACT_STENCIL_FONTS) test(`${font.label}: small text respects cuts, sharing, PDF, margins and folds`, () => {
  for (const thickness of [1, 2, 3, 6, 8, 10]) {
    const height = textMinimumHeight(thickness, font.id);
    const feature = Math.max(2, thickness);
    assert.equal(height, 8 * feature);
    assert.ok(height < textMinimumHeight(thickness, 'stencil-sign'));
    for (const character of 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-.') {
      const cuts = stencilCells({ text: character, font: font.id, height, x: 0, y: 0, rotation: 0 }, thickness);
      assert.ok(cuts.every(cut => cut.length! >= feature - 1e-8 && cut.width! >= feature - 1e-8));
    }
    assert.throws(() => stencilCells({ text: 'AB', font: font.id, height: height - .01, x: 0, y: 0, rotation: 0 }, thickness), /Hauteur minimale/);
  }
  const state = { ...createDefaultProject(), bendCount: 0, thickness: 2 };
  const config = { text: 'TEXT', font: font.id, height: 16, x: 150, y: 150, rotation: 0 as const };
  const saved = applyStencilText(state, 'A', config);
  assert.equal(stencilTextIssue(saved, 'A'), null);
  const restored = readProjectFromUrl(createProjectLink(saved, 'length'))!.state;
  assert.deepEqual(restored.legs[0].cutText, config);
  assert.equal(stencilTextIssue(restored, 'A'), null);
  assert.equal(createDrawingModel(restored).wings[0].holes.length, restored.legs[0].holePositions!.length);
  assert.throws(() => applyStencilText(state, 'A', { ...config, x: 1 }), /marge/);
  const bent = createDefaultProject();
  assert.throws(() => applyStencilText(bent, 'A', { ...config, height: 24, x: bent.legs[0].length - 5 }), /pli|pièce/);
});
