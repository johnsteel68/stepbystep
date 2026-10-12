import assert from 'node:assert/strict';
import { test } from 'node:test';
import { inflateSync } from 'node:zlib';
import { unzipSync } from 'fflate';
import { createDrawingModel, createFlatDrawingModel, generateTechnicalDrawing, getDrawingHoleContour, getExportBaseName } from '../technicalDrawing.ts';
import { createManufacturingArchive } from '../exportDownload.ts';
import type { SheetMetalState } from '../sheetGeometry.ts';
import { createProjectLink, readProjectFromUrl } from '../projectSharing.ts';
import { createProjectQr } from '../projectQr.ts';
import { createDefaultProject } from '../projectDefaults.ts';
import { applyStencilText, stencilCells } from '../stencilText.ts';

test('flat PDF preserves asymmetric letter contours on ordinary and terminal wings', () => {
  for (const bendCount of [0, 1]) for (const blankShape of [undefined, 'rectangle'] as const) {
    if (bendCount && blankShape) continue; // Shaped blanks cannot be folded.
    const base = { ...createDefaultProject(), bendCount, blankShape, blankLength: 600, width: 300 };
    const id = bendCount ? 'B' : 'A';
    const config = { text: 'RORO', font: 'stencil-tenada' as const, height: 72, x: 150, y: 150, rotation: 0 as const };
    const state = applyStencilText(base, id, config);
    const cuts = stencilCells(config, state.thickness);
    const holes = createFlatDrawingModel(state).holes.filter(hole => hole.wing === id && hole.position.textCutout);
    assert.equal(holes.length, cuts.length);
    holes.forEach((hole, i) => hole.contour.forEach((point, j) => {
      assert.ok(Math.abs(point.x - hole.center.x - cuts[i].contour![j].x) < 1e-7);
      assert.ok(Math.abs(point.y - hole.center.y - cuts[i].contour![j].y) < 1e-7);
    }));
  }
});

const plate = (): SheetMetalState => ({
  bendCount: 0, material: 'Steel', finish: 'steel-larme', width: 100, thickness: 5,
  legs: [{ id: 'A', label: 'Aile A', length: 180, hasHole: true, holeDiam: 5, holeDist: 25, holeOffset: 30 }], bends: [],
  cornerRadii: { startLeft: 8, startRight: 12, endLeft: 16, endRight: 20 },
});

test('PDF QR uses the exact exported project, strips callback secrets and stays vector-sharp', async () => {
  const state = createDefaultProject();
  const link = createProjectLink(state, 'width', 'https://step-generator.yop39.chatgpt.site/callback?code=secret');
  assert.ok(!link.includes('secret'));
  assert.equal(readProjectFromUrl(link)?.grainDirection, 'width');
  assert.equal(readProjectFromUrl(link)?.state.legs[0].holeDiam, 5);
  const qr = createProjectQr(link)!;
  assert.ok(qr.rectangles.length > 100);
  assert.ok(qr.rectangles.every(r => r.x >= 4 && r.y >= 4 && r.x + r.width <= qr.size - 4 && r.y < qr.size - 4));
  const pdf = new TextDecoder().decode(await generateTechnicalDrawing(state, { projectLink: link }).arrayBuffer());
  assert.match(pdf, /\/Subtype \/Link/);
  assert.ok(pdf.includes(link));
  assert.doesNotMatch(pdf, /\/Subtype \/Image/);
  assert.equal(createProjectQr('x'.repeat(2201)), null);
});

test('flat plan labels all four nonzero corner radii directly on the drawing', async () => {
  const pdf = Buffer.from(await generateTechnicalDrawing(plate()).arrayBuffer()).toString('latin1');
  const streams = [...pdf.matchAll(/stream\r?\n([\s\S]*?)\r?\nendstream/g)]
    .map(match => inflateSync(Buffer.from(match[1], 'latin1')).toString('latin1')).join('\n');
  for (const radius of [8, 12, 16, 20]) assert.ok(streams.includes(`R ${radius} mm`));
});

test('flat plan has no invented fold and preserves the reversed STEP datum and four corners', () => {
  const model = createDrawingModel(plate());
  assert.equal(model.wings[0].straightLength, 180);
  assert.equal(model.wings[0].reversed, true);
  assert.deepEqual(model.wings[0].corners, { nearLeft: 16, nearRight: 20, farLeft: 8, farRight: 12 });
  assert.deepEqual(model.wings[0].holes[0].position, { dist: 25, offset: 30 });
});

test('formed plan shares actual STEP straight lengths and globally numbers mixed holes', () => {
  const state = plate(); state.bendCount = 1; state.bends = [{ id: '1', angle: 90, direction: 1 }];
  state.legs.push({ ...state.legs[0], id: 'B', length: 100, holePositions: [
    { dist: 20, offset: 20, shape: 'oblong', length: 12, width: 5, orientation: 'along_width' },
    { dist: 40, offset: 60, shape: 'rect', length: 14, width: 8, cornerRadius: 2 },
  ] });
  const model = createDrawingModel(state);
  assert.equal(model.wings[0].straightLength, 170);
  assert.equal(model.wings[1].straightLength, 90);
  assert.equal(model.wings[0].reversed, false);
  assert.equal(model.wings[1].reversed, true);
  assert.deepEqual(model.wings.flatMap(w => w.holes.map(h => h.number)), [1, 2, 3]);
  assert.equal(model.wings[1].holes[1].definition.holeCornerRadius, 2);
});

test('oblong orientation swaps the true cut extents instead of becoming circular', () => {
  const leg = { ...plate().legs[0], holeShape: 'oblong' as const, holeLength: 12, holeWidth: 5, holeOrientation: 'along_width' as const };
  const points = getDrawingHoleContour(leg);
  assert.equal(Math.max(...points.map(p => p.x)) - Math.min(...points.map(p => p.x)), 5);
  assert.equal(Math.max(...points.map(p => p.y)) - Math.min(...points.map(p => p.y)), 12);
});

test('full flat plate keeps all four corners and reverses the terminal local hole datum', () => {
  const state = plate();
  const flat = createFlatDrawingModel(state);
  assert.equal(flat.length, 180);
  assert.equal(flat.folds.length, 0);
  assert.deepEqual(flat.corners, state.cornerRadii);
  assert.deepEqual(flat.holes[0].center, { x: 155, y: 30 });
});

test('developed coordinates include bend allowance and correctly locate holes on both wings', () => {
  const state = plate(); state.bendCount = 1; state.bends = [{ id: '1', angle: 90, direction: -1 }];
  state.legs.push({ ...state.legs[0], id: 'B', length: 100, holeDist: 20, holeOffset: 60,
    holeShape: 'oblong', holeLength: 12, holeWidth: 5, holeOrientation: 'along_width' });
  const flat = createFlatDrawingModel(state);
  const allowance = Math.PI / 2 * 7;
  assert.ok(Math.abs(flat.length - (170 + allowance + 90)) < 1e-6);
  assert.equal(flat.folds[0].toward, 'F2');
  assert.ok(Math.abs(flat.folds[0].center - (170 + allowance / 2)) < 1e-6);
  assert.deepEqual(flat.holes[0].center, { x: 25, y: 30 });
  assert.ok(Math.abs(flat.holes[1].center.x - (170 + allowance + 70)) < 1e-6);
  assert.equal(flat.holes[1].center.y, 60);
  const points = flat.holes[1].contour;
  assert.ok(Math.abs(Math.max(...points.map(p => p.x)) - Math.min(...points.map(p => p.x)) - 5) < 1e-6);
  assert.equal(Math.max(...points.map(p => p.y)) - Math.min(...points.map(p => p.y)), 12);
});

test('all wings share one flat sheet instead of producing one page per wing', async () => {
  const state = plate(); state.bendCount = 4;
  state.bends = Array.from({ length: 4 }, (_, i) => ({ id: String(i + 1), angle: i % 2 ? -90 : 90, direction: 1 as const }));
  state.legs = Array.from({ length: 5 }, (_, i) => ({ ...state.legs[0], id: String.fromCharCode(65 + i), hasHole: false }));
  const flat = createFlatDrawingModel(state);
  assert.equal(flat.wings.length, 5);
  assert.equal(flat.folds.length, 4);
  assert.deepEqual(flat.folds.map(f => f.toward), ['F1', 'F2', 'F1', 'F2']);
  const pdf = new TextDecoder('latin1').decode(await generateTechnicalDrawing(state).arrayBuffer());
  assert.match(pdf, /\/Count 2\b/);
});

test('large hole matrix produces a valid paginated PDF and coherent ZIP names', async () => {
  const state = plate(); state.legs[0].length = 300; state.width = 200;
  state.legs[0].holePattern = { mode: 'square', columns: 20, rows: 10, count: 1, margin: 10 };
  const model = createDrawingModel(state);
  assert.equal(model.holeCount, 200);
  const pdf = generateTechnicalDrawing(state, { date: new Date('2026-10-05T12:00:00Z') });
  const pdfBytes = new Uint8Array(await pdf.arrayBuffer());
  assert.match(new TextDecoder().decode(pdfBytes.slice(0, 8)), /%PDF-/);
  const base = getExportBaseName(state);
  const step = new File(['ISO-10303-21;'], `${base}.step`, { type: 'application/step' });
  const zip = unzipSync(new Uint8Array(await (await createManufacturingArchive(step, pdf)).arrayBuffer()));
  assert.deepEqual(Object.keys(zip), [`${base}.step`, `${base}_Plan.pdf`]);
  assert.equal(new TextDecoder().decode(zip[step.name]), 'ISO-10303-21;');
  assert.deepEqual(zip[`${base}_Plan.pdf`], pdfBytes);
});

test('nonfinite dimensions are rejected rather than producing a misleading drawing', () => {
  const state = plate(); state.width = NaN;
  assert.throws(() => generateTechnicalDrawing(state), /invalides/);
});

test('four-view overview is added without replacing vector details or manufacturing notes', async () => {
  const image = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4XmP4DwQACfsD/YcUtbcAAAAASUVORK5CYII=';
  const view = { image, widthMm: 180, heightMm: 100, frame: { x: .1, y: .1, width: .8, height: .8 } };
  const state = plate();
  const plain = new TextDecoder('latin1').decode(await generateTechnicalDrawing(state).arrayBuffer());
  const full = new TextDecoder('latin1').decode(await generateTechnicalDrawing(state, {
    views: { front: view, top: view, right: view, isometric: { ...view, faceMarkers: [
      { face: 'F1', wing: 'A', x: .5, y: .5, grainEnd: { x: .7, y: .5 } },
    ] } },
  }).arrayBuffer());
  assert.match(plain, /\/Count 2\b/);
  assert.match(full, /\/Count 3\b/);
  assert.match(full, /\/Subtype \/Image/);
});
