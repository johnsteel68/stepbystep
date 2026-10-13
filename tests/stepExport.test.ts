import assert from 'node:assert/strict';
import { before, test } from 'node:test';
import { createRequire } from 'node:module';
import initOpenCascade from 'replicad-opencascadejs';
import { draw, getOC, importSTEP, isShape3D, makeBox, makeCylinder, measureVolume, setOC } from 'replicad';
import { exportStepAp214 } from '../stepExport.ts';
import { stencilCells, textMinimumHeight } from '../stencilText.ts';
import { GOOGLE_STENCIL_FONTS } from '../googleStencilFonts.ts';
import { COMPACT_STENCIL_FONTS } from '../compactStencil.ts';

const require = createRequire(import.meta.url);
before(async () => {
  setOC(await initOpenCascade({ locateFile: () => require.resolve('replicad-opencascadejs/wasm') }));
});

test('native AP214 round-trip preserves a closed plate and millimetre dimensions', async () => {
  const plate = makeBox([0, 0, 0], [100, 60, 3]);
  const text = exportStepAp214(plate);
  assert.match(text, /FILE_SCHEMA\(\('AUTOMOTIVE_DESIGN/);
  assert.doesNotMatch(text, /AP242/);
  const restored = await importSTEP(new Blob([text]));
  assert.ok(isShape3D(restored));
  const check = new (getOC().BRepCheck_Analyzer)(restored.wrapped, true, false, false);
  assert.equal(check.IsValid(), true);
  assert.ok(Math.abs(measureVolume(restored) - 18000) < 0.001);
  check.delete(); restored.delete(); plate.delete();
});

test('native AP214 round-trip preserves the hole instead of returning a plain sheet', async () => {
  const plate = makeBox([0, 0, 0], [100, 60, 3]);
  const cutter = makeCylinder(2.5, 9, [25, 25, -3], [0, 0, 1]);
  const cut = plate.cut(cutter);
  const restored = await importSTEP(new Blob([exportStepAp214(cut)]));
  assert.ok(isShape3D(restored));
  assert.ok(Math.abs(measureVolume(restored) - (18000 - Math.PI * 2.5 ** 2 * 3)) < 0.001);
  restored.delete(); cut.delete(); cutter.delete(); plate.delete();
});

test('continuous stencil strokes export as valid cutouts rather than coincident faces', async () => {
  const cuts = stencilCells({ text: 'B8', font: 'stencil', height: 42, x: 70, y: 40, rotation: 0 }, 2);
  let solid = makeBox([0, 0, 0], [140, 80, 2]);
  try {
    for (const cut of cuts) {
      const cutter = makeBox([cut.dist - cut.length! / 2, cut.offset - cut.width! / 2, -2], [cut.dist + cut.length! / 2, cut.offset + cut.width! / 2, 4]);
      try { const next = solid.cut(cutter); assert.ok(isShape3D(next)); solid.delete(); solid = next; } finally { cutter.delete(); }
    }
    const restored = await importSTEP(new Blob([exportStepAp214(solid)]));
    try { assert.ok(isShape3D(restored)); assert.ok(Math.abs(measureVolume(restored) - measureVolume(solid)) < .001); }
    finally { restored.delete(); }
  } finally { solid.delete(); }
});
test('Tenada vector contours preserve their counters in a valid STEP solid', async () => {
  const cuts = stencilCells({ text: 'B8', font: 'stencil-tenada', height: 48, x: 100, y: 75, rotation: 0 }, 2);
  let solid = makeBox([0, 0, 0], [200, 150, 2]);
  let removedArea = 0;
  try {
    for (const cut of cuts) {
      const points = cut.contour!;
      let path = draw([cut.dist + points[0].x, cut.offset + points[0].y]);
      for (const point of points.slice(1)) path = path.lineTo([cut.dist + point.x, cut.offset + point.y]);
      const cutter = path.close().sketchOnPlane('XY', -2).extrude(6);
      assert.ok(isShape3D(cutter));
      removedArea += Math.abs(points.reduce((area, p, i) => { const q = points[(i + 1) % points.length]; return area + p.x * q.y - q.x * p.y; }, 0)) / 2;
      try { const next = solid.cut(cutter); assert.ok(isShape3D(next)); solid.delete(); solid = next; } finally { cutter.delete(); }
    }
    const restored = await importSTEP(new Blob([exportStepAp214(solid)]));
    const analyzer = new (getOC().BRepCheck_Analyzer)(restored.wrapped, true, false, false);
    try {
      assert.ok(isShape3D(restored));
      assert.equal(analyzer.IsValid(), true);
      assert.ok(Math.abs(measureVolume(restored) - (60000 - removedArea * 2)) < .001);
    } finally { analyzer.delete(); restored.delete(); }
  } finally { solid.delete(); }
});

for (const font of COMPACT_STENCIL_FONTS) test(`${font.label}: compact stencil remains one valid STEP solid at minimum height`, async () => {
  const height = textMinimumHeight(2, font.id);
  const cuts = stencilCells({ text: 'B8', font: font.id, height, x: 50, y: 30, rotation: 0 }, 2);
  let solid = makeBox([0, 0, 0], [100, 60, 2]);
  try {
    for (const cut of cuts) {
      const points = cut.contour ?? [
        { x: -cut.length! / 2, y: -cut.width! / 2 }, { x: cut.length! / 2, y: -cut.width! / 2 },
        { x: cut.length! / 2, y: cut.width! / 2 }, { x: -cut.length! / 2, y: cut.width! / 2 },
      ];
      let path = draw([cut.dist + points[0].x, cut.offset + points[0].y]);
      for (const point of points.slice(1)) path = path.lineTo([cut.dist + point.x, cut.offset + point.y]);
      const cutter = path.close().sketchOnPlane('XY', -2).extrude(6);
      assert.ok(isShape3D(cutter));
      try { const next = solid.cut(cutter); assert.ok(isShape3D(next)); solid.delete(); solid = next; } finally { cutter.delete(); }
    }
    assert.equal(solid.solids.length, 1, 'Every counter must stay attached to the sheet');
    const restored = await importSTEP(new Blob([exportStepAp214(solid)]));
    const analyzer = new (getOC().BRepCheck_Analyzer)(restored.wrapped, true, false, false);
    try {
      assert.ok(isShape3D(restored));
      assert.equal(analyzer.IsValid(), true);
      assert.ok(Math.abs(measureVolume(restored) - measureVolume(solid)) < .001);
      assert.ok(measureVolume(restored) < 12000);
    } finally { analyzer.delete(); restored.delete(); }
  } finally { solid.delete(); }
});

for (const font of GOOGLE_STENCIL_FONTS) test(`${font.label}: vector stencil exports a valid STEP with connected material`, async () => {
  const height = textMinimumHeight(2, font.id);
  const cuts = stencilCells({ text: 'B8', font: font.id, height, x: 350, y: 200, rotation: 0 }, 2);
  let solid = makeBox([0, 0, 0], [700, 400, 2]);
  let removedArea = 0;
  try {
    for (const cut of cuts) {
      assert.ok(cut.contour?.length);
      const points = cut.contour!;
      let path = draw([cut.dist + points[0].x, cut.offset + points[0].y]);
      for (const point of points.slice(1)) path = path.lineTo([cut.dist + point.x, cut.offset + point.y]);
      const cutter = path.close().sketchOnPlane('XY', -2).extrude(6);
      assert.ok(isShape3D(cutter));
      removedArea += Math.abs(points.reduce((area, p, i) => { const q = points[(i + 1) % points.length]; return area + p.x * q.y - q.x * p.y; }, 0)) / 2;
      try { const next = solid.cut(cutter); assert.ok(isShape3D(next)); solid.delete(); solid = next; } finally { cutter.delete(); }
    }
    assert.equal(solid.solids.length, 1, 'Stencil counters must remain attached to the sheet');
    const restored = await importSTEP(new Blob([exportStepAp214(solid)]));
    const analyzer = new (getOC().BRepCheck_Analyzer)(restored.wrapped, true, false, false);
    try {
      assert.ok(isShape3D(restored));
      assert.equal(analyzer.IsValid(), true);
      assert.ok(Math.abs(measureVolume(restored) - (560000 - removedArea * 2)) < .01);
    } finally { analyzer.delete(); restored.delete(); }
  } finally { solid.delete(); }
});
