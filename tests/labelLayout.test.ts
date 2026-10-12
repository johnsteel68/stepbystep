import test from 'node:test';
import assert from 'node:assert/strict';
import { clearsOpenings, wingLabelPoint, holeLabelPoint } from '../viewer/annotations/labelLayout.ts';

test('wing letter moves away from a central opening and stays on the wing', () => {
  const holes = [{ x: 50, y: 50, rx: 10, ry: 10 }];
  const p = wingLabelPoint(100, 100, 8, holes)!;
  assert.ok(p); assert.ok(clearsOpenings(p, 8, holes));
  assert.notDeepEqual(p, { x: 50, y: 50 });
  assert.ok(p.x >= 8 && p.x <= 92 && p.y >= 8 && p.y <= 92);
});
test('letter is suppressed when no material can hold its disk', () => {
  assert.equal(wingLabelPoint(30, 30, 8, [{ x: 15, y: 15, rx: 14, ry: 14 }]), null);
  assert.equal(wingLabelPoint(5, 100, 8, []), null);
});
test('hole number sits beside the entire hole including oblong extents', () => {
  const hole = { x: 50, y: 50, rx: 25, ry: 4 };
  const p = holeLabelPoint(hole, 2, [hole], 100, 100);
  assert.ok(clearsOpenings(p, 2, [hole]));
  assert.ok(Math.abs(p.x - hole.x) > hole.rx + 2 || Math.abs(p.y - hole.y) > hole.ry + 2);
});
test('number chooses another side when the preferred side contains a second hole', () => {
  const hole = { x: 50, y: 50, rx: 3, ry: 3 };
  const openings = [hole, { x: 56, y: 50, rx: 3, ry: 3 }];
  const p = holeLabelPoint(hole, 2, openings, 100, 100);
  assert.ok(clearsOpenings(p, 2, openings));
});
