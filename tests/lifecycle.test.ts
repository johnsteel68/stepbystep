import assert from 'node:assert/strict';
import test from 'node:test';
import { createRetryableInitializer } from '../lifecycle.ts';

test('concurrent initialization is shared and success cached', async () => {
  let count = 0;
  const initialize = createRetryableInitializer(async () => { count++; return 42; });
  const first = initialize();
  assert.equal(first, initialize());
  assert.equal(await first, 42);
  assert.equal(await initialize(), 42);
  assert.equal(count, 1);
});

test('initialization can retry after a network rejection', async () => {
  let count = 0;
  const initialize = createRetryableInitializer(async () => {
    if (++count === 1) throw new Error('network');
    return 'ready';
  });
  await assert.rejects(initialize(), /network/);
  assert.equal(await initialize(), 'ready');
  assert.equal(count, 2);
});

test('synchronous setup failure also releases the cache', async () => {
  let count = 0;
  const initialize = createRetryableInitializer(() => {
    if (++count === 1) throw new Error('setup');
    return Promise.resolve('ready');
  });
  await assert.rejects(initialize(), /setup/);
  assert.equal(await initialize(), 'ready');
});
