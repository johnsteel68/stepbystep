import test from 'node:test';
import assert from 'node:assert/strict';
import { advanceKonamiCode, KONAMI_CODE } from '../konamiCode.ts';

test('the classic Konami sequence unlocks the STEP export', () => {
  let progress = 0;
  for (const [index, key] of KONAMI_CODE.entries()) {
    const result = advanceKonamiCode(progress, key);
    assert.equal(result.unlocked, index === KONAMI_CODE.length - 1);
    progress = result.progress;
  }
});

test('a mismatch resets progress but a new first key starts again', () => {
  assert.deepEqual(advanceKonamiCode(3, 'x'), { progress: 0, unlocked: false });
  assert.deepEqual(advanceKonamiCode(3, 'ArrowUp'), { progress: 1, unlocked: false });
});
