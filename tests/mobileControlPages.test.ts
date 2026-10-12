import assert from 'node:assert/strict';
import test from 'node:test';
import { mobileControlPages } from '../components/mobileControlPages.ts';

test('compact steps need no secondary navigation', () => {
  assert.deepEqual(mobileControlPages([0, 60, 110], 160, 180), [0]);
});
test('mobile form pages cover every field without a gap at all viewport sizes', () => {
  for (const viewport of [44, 96, 140, 200, 320, 500]) {
    const total = 950, pages = mobileControlPages([0, 60, 150, 230, 320, 440, 590, 750, 880], total, viewport);
    assert.equal(pages[0], 0);
    assert.ok(pages[pages.length - 1] + viewport >= total - 2);
    for (let index = 1; index < pages.length; index++) {
      assert.ok(pages[index] > pages[index - 1]);
      assert.ok(pages[index] - pages[index - 1] <= viewport);
    }
  }
});
test('pagination prefers a field row rather than an arbitrary cut', () => {
  assert.equal(mobileControlPages([0, 90, 170, 260], 400, 180)[1], 90);
});
test('unmounted or collapsed docks never loop', () => {
  assert.deepEqual(mobileControlPages([], 1000, 0), [0]);
});
