import test from 'node:test';
import assert from 'node:assert/strict';
import { callTool, handleMcp } from '../mcp/worker.ts';

const base = { bendCount: 0, finish: 'steel-raw', thickness: 3, width: 100, legLengths: [100] };
test('each single rounded corner survives the project link, other corners stay square', () => {
  for (const key of ['startLeft', 'startRight', 'endLeft', 'endRight']) {
    const result = callTool('create_piece', { ...base, cornerRadii: { [key]: 15 } });
    assert.equal(result.valid, true);
    const restored = callTool('inspect_piece', { url: result.url });
    assert.deepEqual(restored.project.state.cornerRadii, { startLeft: 0, startRight: 0, endLeft: 0, endRight: 0, [key]: 15 });
  }
  for (const value of [-1, 51, NaN, '15']) assert.throws(() => callTool('create_piece', { ...base, cornerRadii: { startLeft: value } }));
  assert.throws(() => callTool('create_piece', { ...base, cornerRadii: { topLeft: 15 } }));
  assert.throws(() => callTool('create_piece', { ...base, bendCount: 1, legLengths: [40, 100], cornerRadii: { startLeft: 21 } }));
});
test('customer link restores bends, dimensions, finish and holes exactly', () => {
  const result = callTool('create_piece', { ...base, bendCount: 1, width: 200, legLengths: [80, 120], angles: [90], directions: [-1], holes: [{ leg: 0, dist: 25, offset: 40 }] });
  assert.equal(result.valid, true);
  const restored = callTool('inspect_piece', { url: result.url });
  assert.deepEqual(restored.project, result.project);
  assert.equal(restored.project.state.legs[0].holePositions[0].diam, 5);
  assert.ok(result.url.startsWith('https://stepbystep.john-steel.com/?projet='));
});
test('MCP creates a shareable validated plate, never an order', () => {
  const result = callTool('create_piece', base);
  assert.equal(result.valid, true);
  assert.equal(callTool('inspect_piece', { url: result.url }).valid, true);
});
test('MCP refuses oversized sheets, forbidden folding and fold holes', () => {
  assert.equal(callTool('create_piece', { ...base, width: 2000, legLengths: [3000] }).valid, false);
  assert.equal(callTool('create_piece', { ...base, bendCount: 1, finish: 'stainless-mirror', thickness: 1.5, legLengths: [100, 100] }).valid, false);
  assert.throws(() => callTool('create_piece', { ...base, bendCount: 1, legLengths: [100, 100], holes: [{ leg: 0, dist: 99, offset: 50 }] }));
  assert.throws(() => callTool('create_piece', { ...base, holes: [{ leg: 0, dist: 25, offset: 25 }, { leg: 0, dist: 26, offset: 25 }] }));
});
test('MCP discovery is public but tool execution requires Sites identity', async () => {
  const request = (method: string, authenticated = false) => new Request('https://example.com/mcp', { method: 'POST', headers: authenticated ? { 'oai-authenticated-user-id': 'test-fixture' } : {}, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params: { name: 'list_materials', arguments: {} } }) });
  assert.equal((await handleMcp(request('tools/call'))).status, 401);
  assert.equal((await (await handleMcp(request('tools/list'))).json()).result.tools.length, 3);
  assert.equal((await (await handleMcp(request('tools/call', true))).json()).result.structuredContent.stock.width, 1480);
  assert.equal((await handleMcp(new Request('https://example.com/mcp'))).status, 405);
});
