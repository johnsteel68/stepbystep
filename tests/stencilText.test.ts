import assert from 'node:assert/strict';
import test from 'node:test';
import { applyStencilText, fitStencilText, stencilCells, stencilTextIssue, textAvailabilityIssue, hasPendingStencilText, STENCIL_FONTS, SELECTABLE_STENCIL_FONTS, textMinimumHeight } from '../stencilText.ts';
import { createWorkflow } from '../workflow.ts';
import { blankTextBlockAllowed } from '../formedBlank.ts';
import { createDefaultProject } from '../projectDefaults.ts';
import { createProjectLink, readProjectFromUrl } from '../projectSharing.ts';
import { createDrawingModel } from '../technicalDrawing.ts';
import { checkSheetMetalFeasibility } from '../sheetGeometry.ts';
import { GOOGLE_STENCIL_FONTS } from '../googleStencilFonts.ts';
import { getGoogleStencilGlyphs } from '../googleStencilLoader.ts';

const flat = () => ({ ...createDefaultProject(), bendCount: 0, width: 150, legs: createDefaultProject().legs.map(l => ({ ...l, length: 200 })) });
const config = { text: 'A1', height: 30, x: 100, y: 75, rotation: 0 as const };
test('font picker offers distinct designs while preserving legacy variant identifiers', () => {
  assert.equal(SELECTABLE_STENCIL_FONTS.length, 36);
  for (const id of ['stencil-condensed', 'stencil-wide', 'stencil-tenada-condensed', 'stencil-tenada-wide']) {
    assert.ok(STENCIL_FONTS.some(font => font.id === id));
    assert.ok(!SELECTABLE_STENCIL_FONTS.some(font => font.id === id));
  }
});
test('distinct Google stencil designs decode once and retain their original outlines when moved', () => {
  assert.equal(GOOGLE_STENCIL_FONTS.length, 27);
  assert.equal(new Set(GOOGLE_STENCIL_FONTS.map(font => font.id)).size, 27);
  const outlines = new Set<string>();
  for (const font of GOOGLE_STENCIL_FONTS) {
    const glyphs = getGoogleStencilGlyphs(font.id)!;
    assert.equal(getGoogleStencilGlyphs(font.id), glyphs);
    const original = JSON.stringify(glyphs);
    outlines.add(JSON.stringify(glyphs.A.contours));
    stencilCells({ ...config, font: font.id, height: textMinimumHeight(2, font.id), x: 700, y: 300, rotation: 90 }, 2);
    assert.equal(JSON.stringify(glyphs), original, 'Dragging/rotation must never mutate the shared font cache');
  }
  assert.equal(outlines.size, 27, 'These are different designs, not stretched duplicates');
});
test('terminal-wing vector letters retain their handedness after validation', () => {
  const settings = { ...config, text: 'RORO', font: 'stencil-tenada' as const, height: 72, x: 250, y: 100 };
  const state = { ...flat(), width: 200, legs: flat().legs.map(l => ({ ...l, length: 500 })) };
  const draft = stencilCells(settings, state.thickness);
  const saved = applyStencilText(state, 'A', settings).legs[0].holePositions!;
  for (const [i, cut] of saved.entries()) {
    assert.deepEqual(cut.contour, draft[i].contour);
    assert.equal(cut.dist, 2 * settings.x - draft[i].dist);
  }
});
test('text envelope respects circular contours rather than just its centre', () => {
  const state = { ...flat(), blankShape: 'circle' as const, width: 100, legs: flat().legs.map(l => ({ ...l, length: 100 })) };
  assert.equal(blankTextBlockAllowed(state, 0, 50, 50, 20, 20), true);
  assert.equal(blankTextBlockAllowed(state, 0, 50, 50, 40, 40), false);
  assert.equal(blankTextBlockAllowed(state, 0, 20, 50, 20, 20), false);
});
test('text envelope cannot cover an integral washer opening', () => {
  const state = { ...flat(), blankShape: 'washer' as const, blankInnerDiameter: 20, width: 100, legs: flat().legs.map(l => ({ ...l, length: 100 })) };
  assert.equal(blankTextBlockAllowed(state, 0, 50, 50, 20, 20), false);
});
test('draft text must be validated or deleted before leaving', () => {
  assert.equal(hasPendingStencilText(flat(), { legId: 'A', config }), true);
  const state = applyStencilText(flat(), 'A', config);
  assert.equal(hasPendingStencilText(state, { legId: 'A', config }), false);
  assert.equal(hasPendingStencilText(state, { legId: 'A', config: { ...config, x: 101 } }), true);
  assert.equal(hasPendingStencilText(state, { legId: 'A', config: { ...config, text: '' } }), true);
  assert.equal(hasPendingStencilText(applyStencilText(state, 'A', null), { legId: 'A', config: { ...config, text: '' } }), false);
});
test('whole text block must fit with a safety margin', () => {
  assert.throws(() => applyStencilText({ ...flat(), thickness: 1 }, 'A', { ...config, x: 2 }), /marge/);
  assert.ok(textAvailabilityIssue({ ...flat(), width: 20, legs: flat().legs.map(l => ({ ...l, length: 20 })) }));
});
test('text is excluded on patterned finishes, but existing text remains removable', () => {
  const saved = applyStencilText(flat(), 'A', config);
  for (const finish of ['steel-larme', 'aluminum-larme', 'stainless-antislip', 'aluminum-perforated'] as const) {
    const state = { ...flat(), finish };
    assert.ok(textAvailabilityIssue(state));
    assert.equal(createWorkflow(state).some(page => page.section === 12), false);
    assert.throws(() => applyStencilText(state, 'A', config));
    const changed = { ...saved, finish };
    assert.ok(stencilTextIssue(changed, 'A'));
    assert.equal(applyStencilText(changed, 'A', null).legs[0].hasHole, false);
  }
});
test('thickness eligibility depends on room for bridges and letters, not an arbitrary cap', () => {
  assert.ok(textAvailabilityIssue({ ...flat(), thickness: 20, width: 100, legs: flat().legs.map(l => ({ ...l, length: 100 })) }));
  assert.equal(textAvailabilityIssue({ ...flat(), thickness: 20, width: 1000, legs: flat().legs.map(l => ({ ...l, length: 1000 })) }), null);
});
for (const font of STENCIL_FONTS.filter(f => f.id.startsWith('stencil'))) test(`${font.label}: counters stay attached and features respect the thickness minimum`, () => {
    for (const character of 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789') {
      const cuts = stencilCells({ text: character, font: font.id, height: textMinimumHeight(2, font.id), x: 0, y: 0, rotation: 0 }, 2);
      assert.ok(cuts.every(c => c.length! >= 2 - 1e-8 && c.width! >= 2 - 1e-8));
      // Flood-fill the remaining sheet from its perimeter. Any unreachable
      // material would be an island that falls out during laser cutting.
      const span = Math.max(...cuts.map(c => Math.abs(c.dist) + c.length! / 2), ...cuts.map(c => Math.abs(c.offset) + c.width! / 2)) * 2 + 8;
      const n = 241, step = span / (n - 2), material = new Uint8Array(n * n), visited = new Uint8Array(n * n);
      for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
        const px = (x - 120) * step + step / 2, py = (y - 120) * step + step / 2;
        material[y * n + x] = cuts.some(c => {
          if (Math.abs(px - c.dist) >= c.length! / 2 || Math.abs(py - c.offset) >= c.width! / 2) return false;
          if (!c.contour) return Math.abs(px - c.dist) < c.length! / 2 - 1e-8 && Math.abs(py - c.offset) < c.width! / 2 - 1e-8;
          let inside = false;
          const x = px - c.dist, y = py - c.offset;
          for (let i = 0, j = c.contour.length - 1; i < c.contour.length; j = i++) {
            const a = c.contour[i], b = c.contour[j];
            if ((a.y > y) !== (b.y > y) && x < (b.x - a.x) * (y - a.y) / (b.y - a.y) + a.x) inside = !inside;
          }
          return inside;
        }) ? 0 : 1;
      }
      const queue = [0]; visited[0] = 1;
      for (let cursor = 0; cursor < queue.length; cursor++) {
        const i = queue[cursor], x = i % n, y = Math.floor(i / n);
        for (const next of [x > 0 ? i - 1 : -1, x < n - 1 ? i + 1 : -1, y > 0 ? i - n : -1, y < n - 1 ? i + n : -1])
          if (next >= 0 && material[next] && !visited[next]) { visited[next] = 1; queue.push(next); }
      }
      assert.ok(material.every((v, i) => !v || visited[i]), `${font.id}/${character}: detached counter`);
    }
});
for (const font of STENCIL_FONTS) test(`${font.id}: genuine cutouts, safe minimum and shared font choice`, () => {
  const settings = { ...config, text: 'AM', height: Math.max(45, textMinimumHeight(3, font.id)), font: font.id };
  const state = applyStencilText({ ...flat(), width: 800, legs: flat().legs.map(l => ({ ...l, length: 1200 })) }, 'A', { ...settings, x: 600, y: 400 });
  const holes = state.legs[0].holePositions!;
  assert.ok(holes.length > (font.id.startsWith('stencil-google-') || font.id.startsWith('stencil-tenada') || ['stencil-sunfonts', 'stencil-butler'].includes(font.id) ? 0 : 10));
  assert.ok(holes.every(hole => hole.shape === (font.id.startsWith('stencil') ? 'rect' : font.id === 'dots' ? 'round' : 'square')));
  assert.equal(stencilTextIssue(state, 'A'), null);
  const restored = readProjectFromUrl(createProjectLink(state, 'length'))!.state;
  assert.equal(restored.legs[0].cutText!.font, font.id);
  assert.equal(stencilTextIssue(restored, 'A'), null);
  assert.throws(() => stencilCells({ ...settings, height: textMinimumHeight(3, font.id) - 1 }, 3));
});
test('editing fits the whole block or refuses the transaction', () => {
  const state = flat();
  const fitted = fitStencilText(state, 'A', { ...config, font: 'stencil-sign', height: 1000, x: 1, y: 1 });
  assert.ok(fitted.height < 1000);
  assert.equal(stencilTextIssue(applyStencilText(state, 'A', fitted), 'A'), null);
  assert.throws(() => fitStencilText({ ...state, width: 10 }, 'A', { ...config, font: 'stencil-sign' }));
});
test('stencil cutouts survive PDF and sharing, and are removable independently', () => {
  const state = applyStencilText(flat(), 'A', config);
  assert.ok(state.legs[0].holePositions!.length > 10);
  assert.equal(createDrawingModel(state).wings[0].holes.length, state.legs[0].holePositions!.length);
  const restored = readProjectFromUrl(createProjectLink(state, 'length'))!.state;
  assert.deepEqual(restored.legs[0].cutText, config);
  assert.equal(stencilTextIssue(restored, 'A'), null);
  assert.equal(applyStencilText(state, 'A', null).legs[0].hasHole, false);
});
test('stencil blocks undersized features, edges, existing openings and bend zones', () => {
  assert.throws(() => stencilCells({ ...config, height: 10 }, 3));
  assert.throws(() => applyStencilText(flat(), 'A', { ...config, x: 1 }));
  const folded = createDefaultProject();
  assert.throws(() => applyStencilText(folded, 'A', { ...config, x: folded.legs[0].length - 1, y: 50 }));
  const state = flat();
  state.legs[0] = { ...state.legs[0], hasHole: true, holePositions: [{ dist: 100, offset: 75, shape: 'rect', length: 100, width: 50 }] };
  assert.throws(() => applyStencilText(state, 'A', config));
});
test('thicker stock requires revalidation, and vertical text produces genuine cutouts', () => {
  const state = applyStencilText(flat(), 'A', { ...config, rotation: 90 });
  assert.equal(stencilTextIssue(state, 'A'), null);
  assert.ok(checkSheetMetalFeasibility({ ...state, thickness: 6 }).checks.some(c => c.id === 'text_A' && c.status === 'fail'));
});
