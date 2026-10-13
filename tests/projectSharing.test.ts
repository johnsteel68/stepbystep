import assert from 'node:assert/strict';
import { test } from 'node:test';
import { deflateSync, strToU8 } from 'fflate';
import { createProjectLink, PROJECT_HASH, PROJECT_SITE, readProjectFromUrl, readSharedProject } from '../projectSharing.ts';
import { SHEET_FINISHES } from '../sheetGeometry.ts';
import type { SheetMetalState } from '../sheetGeometry.ts';

const part = (): SheetMetalState => ({
  bendCount: 1, material: 'Steel', finish: 'steel-raw', width: 120, thickness: 3,
  legs: [...'ABCDE'].map(id => ({ id, label: `Aile ${id}`, length: 80, hasHole: false, holeDiam: 5, holeDist: 25, holeOffset: 25 })),
  bends: [1, 2, 3, 4].map((n, i) => ({ id: String(n), angle: 90, direction: i % 2 ? -1 : 1 })),
  cornerRadius: 0, cornerRadii: { startLeft: 2, startRight: 3, endLeft: 4, endRight: 5 },
});

test('detailed projects use a fragment instead of an oversized HTTP request line', () => {
  const state = part();
  let seed = 42;
  const random = () => { seed = seed * 16807 % 2147483647; return seed / 2147483647; };
  state.legs[0].hasHole = true;
  state.legs[0].holePositions = Array.from({ length: 200 }, () => ({ dist: 10 + random() * 60, offset: 10 + random() * 100, diam: 5, shape: 'round' }));
  const link = createProjectLink(state, 'length'), url = new URL(link);
  assert.ok(link.length > 2000);
  assert.equal(url.pathname, '/'); assert.equal(url.search, '');
  assert.ok(url.hash.startsWith(PROJECT_HASH));
  assert.deepEqual(readProjectFromUrl(link), { state, grainDirection: 'length' });
  const legacy = `${url.origin}/?projet=${url.hash.slice('#projet='.length)}`;
  assert.deepEqual(readProjectFromUrl(legacy), readProjectFromUrl(link));
});
const hashFor = (value: unknown) => PROJECT_HASH + Buffer.from(deflateSync(strToU8(JSON.stringify(value)))).toString('base64url');
test('star sharing keeps its editable branches and height', () => {
  const state = { ...part(), bendCount: 0, blankShape: 'star' as const, blankLength: 100, blankWidth: 100, blankBranchCount: 8, blankBranchHeight: 15 };
  const restored = readProjectFromUrl(createProjectLink(state, 'length'))?.state;
  assert.equal(restored?.blankBranchCount, 8);
  assert.equal(restored?.blankBranchHeight, 15);
  assert.throws(() => createProjectLink({ ...state, blankBranchHeight: 50 }, 'length'));
});
test('gear sharing preserves tooth count, height and optional bore', () => {
  const state = { ...part(), bendCount: 0, blankShape: 'gear' as const, blankLength: 100, blankWidth: 100,
    blankToothCount: 32, blankToothHeight: 8, blankInnerDiameter: 20 };
  const restored = readProjectFromUrl(createProjectLink(state, 'length'))?.state;
  assert.equal(restored?.blankToothCount, 32);
  assert.equal(restored?.blankToothHeight, 8);
  assert.equal(restored?.blankInnerDiameter, 20);
  assert.throws(() => createProjectLink({ ...state, blankInnerDiameter: 90 }, 'length'));
});

test('washer sharing preserves its editable interior diameter', () => {
  const state = { ...part(), bendCount: 0, blankShape: 'washer' as const, blankLength: 120, blankWidth: 120, blankInnerDiameter: 42 };
  const result = readProjectFromUrl(createProjectLink(state, 'length'));
  assert.equal(result?.state.blankShape, 'washer');
  assert.equal(result?.state.blankInnerDiameter, 42);
});

test('shared project restores the complete configuration and manufacturing grain direction', () => {
  const state = part(); state.bendCount = 4; state.bends[2].angle = 65;
  state.legs[1].hasHole = true;
  state.legs[1].holePositions = [
    { dist: 30.125, offset: 20, shape: 'oblong', width: 5, length: 14, orientation: 'along_width' },
    { dist: 45, offset: 70, shape: 'rect', width: 9, length: 15, cornerRadius: 2 },
  ];
  state.legs[2].holePattern = { mode: 'square', rows: 10, columns: 20, count: 1, margin: 12 };
  state.holePattern = { mode: 'corners', rows: 2, columns: 2, count: 4, margin: 10 };
  const url = createProjectLink(state, 'width');
  assert.deepEqual(readProjectFromUrl(url), { state, grainDirection: 'width' });
  assert.equal(createProjectLink(state, 'width'), url);
  assert.ok(url.length < 2200, 'a complex ordinary project should fit in a QR code');
});

test('every material finish and its available thicknesses can be shared, including a flat plate', () => {
  for (const [finish, config] of Object.entries(SHEET_FINISHES)) {
    for (const thickness of config.thicknesses) {
      const state = { ...part(), bendCount: 0, material: config.family, finish: finish as SheetMetalState['finish'], thickness };
      assert.deepEqual(readProjectFromUrl(createProjectLink(state, 'length'))?.state, state);
    }
  }
});

test('sharing strips callback codes, query tokens and existing fragments', () => {
  const link = createProjectLink(part(), 'length', 'https://step-generator.yop39.chatgpt.site/callback?code=SECRET&state=SECRET#private');
  assert.ok(link.startsWith(PROJECT_SITE + '?projet=v1.'));
  assert.ok(!link.includes('SECRET') && !link.includes('callback'));
  for (const url of ['http://127.0.0.1:3090/', 'http://localhost:3000/', 'file:///Users/name/index.html']) {
    assert.ok(createProjectLink(part(), 'length', url).startsWith(PROJECT_SITE));
  }
  assert.ok(createProjectLink(part(), 'length', 'https://stepbystep.john-steel.com/?code=secret').startsWith('https://stepbystep.john-steel.com/?projet='));
});

test('migration sends default, localhost and legacy shares to John Steel without changing the project', () => {
  assert.equal(PROJECT_SITE, 'https://stepbystep.john-steel.com/');
  const state = part();
  const canonical = createProjectLink(state, 'length');
  for (const current of [
    'http://localhost:3000/',
    'https://step-generator.yop39.chatgpt.site/?code=private',
    'https://stepbystep.john-steel.com/callback?code=private',
  ]) assert.equal(createProjectLink(state, 'length', current), canonical);
  const legacy = canonical.replace(PROJECT_SITE, 'https://step-generator.yop39.chatgpt.site/');
  assert.deepEqual(readProjectFromUrl(legacy), readProjectFromUrl(canonical));
});

test('invalid, unsupported, truncated and oversized links fall back safely', () => {
  for (const hash of ['', '#anything', '#projet=v2.AAAA', PROJECT_HASH, PROJECT_HASH + 'not-a-project', PROJECT_HASH + '<script>', PROJECT_HASH + 'A'.repeat(32_001)]) {
    assert.equal(readSharedProject(hash), null);
  }
  const valid = '#projet=' + new URL(createProjectLink(part(), 'length')).searchParams.get('projet');
  assert.equal(readSharedProject(valid.slice(0, -25)), null);
  assert.equal(readSharedProject(hashFor({ state: part(), grainDirection: 'bad' })), null);
});

test('bounded decompression rejects a compressed oversized payload', () => {
  const hash = hashFor({ state: part(), grainDirection: 'length', padding: ' '.repeat(1_000_000) });
  assert.ok(hash.length < 32_000);
  assert.equal(readSharedProject(hash), null);
});

test('untrusted extra fields and labels cannot inject UI or object keys', () => {
  const state = part(); state.legs[0].label = '<script>bad</script>';
  const dirty = JSON.parse(JSON.stringify({ state, grainDirection: 'length' }).replace('"state":{', '"secret":"not shared","state":{"__proto__":{"polluted":true},'));
  const clean = readSharedProject(hashFor(dirty));
  assert.equal(clean?.state.legs[0].label, 'Aile A');
  assert.ok(!JSON.stringify(clean).includes('polluted'));
  assert.ok(!createProjectLink(dirty.state, 'length').includes('secret'));
});

test('invalid dimensions, shapes, stock and excessive hole counts are rejected', () => {
  const invalid = [
    (s: SheetMetalState) => { s.width = NaN; },
    (s: SheetMetalState) => { s.width = -1; },
    (s: SheetMetalState) => { s.width = 1e9; },
    (s: SheetMetalState) => { s.bendCount = 8; },
    (s: SheetMetalState) => { s.thickness = 999; },
    (s: SheetMetalState) => { s.finish = 'aluminum-raw'; },
    (s: SheetMetalState) => { s.legs[0].holePositions = Array.from({ length: 401 }, () => ({ dist: 20, offset: 20 })); },
    (s: SheetMetalState) => { s.legs[0].holeShape = 'unknown' as never; },
    (s: SheetMetalState) => { s.legs[0].holePattern = { mode: 'square', count: 4, rows: 999, columns: 999, margin: 10 }; },
  ];
  for (const mutate of invalid) {
    const state = part(); mutate(state);
    assert.throws(() => createProjectLink(state, 'length'));
    assert.equal(readSharedProject(hashFor({ state, grainDirection: 'length' })), null);
  }
});

test('project survives a sign-in return URL and legacy fragment links still work', () => {
  const state = part();
  const link = createProjectLink(state, 'width');
  const returnTo = encodeURIComponent(new URL(link).pathname + new URL(link).search);
  const returned = new URL(decodeURIComponent(returnTo), PROJECT_SITE).href;
  assert.deepEqual(readProjectFromUrl(returned), { state, grainDirection: 'width' });
  const oldLink = PROJECT_SITE + hashFor({ state, grainDirection: 'width' });
  assert.deepEqual(readProjectFromUrl(oldLink), { state, grainDirection: 'width' });
  assert.equal(readProjectFromUrl(PROJECT_SITE + '?projet=v2.bad'), null);
});
