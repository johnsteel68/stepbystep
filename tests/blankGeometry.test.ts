import assert from 'node:assert/strict';
import test from 'node:test';
import { blankInnerContours, pointInBlank } from '../blankGeometry.ts';
test('star controls set branch count and radial valley-to-tip height', () => {
  const star = { shape: 'star' as const, length: 100, width: 100, branchCount: 8, branchHeight: 15 };
  assert.equal(blankEdges(star).length, 16);
  const radii = sampleBlank(star).map(p => Math.hypot(p.x - 50, p.y - 50));
  assert.ok(Math.abs(Math.min(...radii) - 35) < 1e-6);
  assert.ok(Math.abs(Math.max(...radii) - 50) < 1e-6);
  assert.equal(normalizeBlank({ shape: 'star', length: 100, width: 100 }).branchCount, 5);
  for (const patch of [{ branchCount: 2 }, { branchCount: 31 }, { branchCount: 5.5 }, { branchHeight: 0 }, { branchHeight: 50 }]) assert.throws(() => normalizeBlank({ ...star, ...patch }));
});

test('gear settings drive the contour and reject malformed or oversized bores', () => {
  const gear = { shape: 'gear' as const, length: 100, width: 100, toothCount: 24, toothHeight: 10, innerDiameter: 20 };
  assert.equal(blankEdges(gear).length, 96);
  assert.equal(blankInnerContours(gear).length, 1);
  assert.equal(pointInBlank(gear, 50, 50), false);
  const roots = sampleBlank(gear).map(p => Math.hypot(p.x - 50, p.y - 50));
  assert.ok(Math.abs(Math.min(...roots) - 40) < 1e-6);
  for (const patch of [{ toothCount: 5 }, { toothCount: 24.5 }, { toothHeight: 49 }, { innerDiameter: 80 }]) assert.throws(() => normalizeBlank({ ...gear, ...patch }));
});
import { BLANK_SHAPES, blankEdges, blankProjection, holeClearsParallelFolds, intersectBlankLine,
  normalizeBlank, resolveParallelFolds, sampleBlank } from '../blankGeometry.ts';

test('all twelve blank shapes have finite closed analytical outlines and positive area', () => {
  assert.equal(BLANK_SHAPES.length, 14);
  for (const { id } of BLANK_SHAPES) {
    const definition = normalizeBlank({ shape: id, length: 150, width: 100 });
    const points = sampleBlank(definition);
    assert.ok(points.length >= 4);
    assert.ok(points.every(p => Number.isFinite(p.x) && Number.isFinite(p.y)
      && p.x >= -1e-6 && p.y >= -1e-6 && p.x <= definition.length + 1e-6 && p.y <= definition.width + 1e-6));
    const area = points.reduce((sum, p, i) => {
      const next = points[(i + 1) % points.length];
      return sum + p.x * next.y - next.x * p.y;
    }, 0) / 2;
    assert.ok(area > 0, id);
    for (const axis of [{ x: 1, y: 0 }, { x: 0, y: 1 }]) {
      const bounds = blankProjection(definition, axis);
      assert.ok(bounds.min >= -1e-6, id);
      assert.ok(bounds.max <= (axis.x ? definition.length : definition.width) + 1e-6, id);
      assert.ok(bounds.max > bounds.min, id);
    }
  }
});

test('round shapes retain analytical arcs, regular polygons keep their dimensions', () => {
  assert.equal(blankEdges({ shape: 'circle', length: 100, width: 80 })[0].type, 'ellipse');
  assert.equal(sampleBlank({ shape: 'circle', length: 100, width: 80 }).length, 384);
  assert.equal(normalizeBlank({ shape: 'semicircle', length: 100, width: 80 }).width, 50);
  assert.equal(blankEdges({ shape: 'hexagon', length: 200, width: 100 }).length, 6);
  assert.equal(blankEdges({ shape: 'octagon', length: 200, width: 100 }).length, 8);
  assert.throws(() => blankEdges({ shape: 'drop', length: 20, width: 100 }));
});

test('fold line clips to the actual disc rather than its rectangular bounding box', () => {
  const disc = { shape: 'circle' as const, length: 100, width: 100 };
  const hits = intersectBlankLine(disc, { x: 0, y: 1 }, 20);
  assert.equal(hits.length, 2);
  assert.ok(hits.every(p => Math.abs(Math.hypot(p.x - 50, p.y - 50) - 50) < 1e-6));
  assert.equal(intersectBlankLine(disc, { x: 0, y: 1 }, 100).length, 1);
  assert.equal(intersectBlankLine(disc, { x: 0, y: 1 }, 101).length, 0);
});

test('parallel folds support oblique orientation and independent positions', () => {
  const blank = { shape: 'rectangle' as const, length: 200, width: 100 };
  const folds = resolveParallelFolds(blank, { orientation: 35, folds: [
    { id: '1', position: 40, angle: 90, direction: 1 },
    { id: '2', position: 100, angle: 45, direction: -1 },
  ] }, 3);
  assert.equal(folds.length, 2);
  assert.equal(folds[0].normal, folds[1].normal);
  for (const fold of folds) for (const p of [fold.start, fold.end]) {
    assert.ok(Math.abs(p.x * fold.normal.x + p.y * fold.normal.y - fold.offset) < 1e-6);
  }
  assert.throws(() => resolveParallelFolds(blank, { orientation: 0, folds: [
    { id: '1', position: 40, angle: 90, direction: 1 },
    { id: '2', position: 45, angle: 90, direction: 1 },
  ] }, 3));
});

test('the whole hole envelope must clear folds, including tangency and oblique matrices', () => {
  const blank = { shape: 'rectangle' as const, length: 200, width: 100 };
  const folds = resolveParallelFolds(blank, { orientation: 0,
    folds: [{ id: '1', position: 50, angle: 90, direction: 1 }] }, 3);
  assert.equal(holeClearsParallelFolds({ x: 80, y: 50 }, 2.5, 2.5, folds), false);
  assert.equal(holeClearsParallelFolds({ x: 80, y: 63 }, 2.5, 2.5, folds), false);
  assert.equal(holeClearsParallelFolds({ x: 80, y: 64 }, 2.5, 2.5, folds), true);
  assert.equal(holeClearsParallelFolds({ x: NaN, y: 80 }, 2.5, 2.5, folds), false);
  assert.equal([{ x: 10, y: 20 }, { x: 80, y: 50 }].every(p => holeClearsParallelFolds(p, 2.5, 2.5, folds)), false);
});
