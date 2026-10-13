import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync, existsSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { transpileModule, ModuleKind } from 'typescript';
import { readProjectFromUrl } from '../projectSharing.ts';
import { checkSheetMetalFeasibility } from '../sheetGeometry.ts';
import { createDefaultProject } from '../projectDefaults.ts';

// Exercise the actual browser exporter in Node/OCC. Only Vite's WASM URL
// import is replaced with the same installed binary's filesystem location.
const nativeRequire = createRequire(import.meta.url);
const { importSTEP, isShape3D, getOC } = nativeRequire('replicad');
const cache = new Map<string, { exports: any }>();
function loadSource(path: string): any {
  const prior = cache.get(path);
  if (prior) return prior.exports;
  const module = { exports: {} as any };
  cache.set(path, module);
  const js = transpileModule(readFileSync(path, 'utf8'), {
    compilerOptions: { module: ModuleKind.CommonJS, esModuleInterop: true },
  }).outputText;
  const requireSource = (name: string) => {
    if (name === 'replicad-opencascadejs/wasm?url') return nativeRequire.resolve('replicad-opencascadejs/wasm');
    if (!name.startsWith('.')) return nativeRequire(name);
    const base = resolve(dirname(path), name);
    return loadSource(existsSync(base) ? base : base + '.ts');
  };
  new Function('require', 'module', 'exports', js)(requireSource, module, module.exports);
  return module.exports;
}

test('shared bent TEXT piece generates a readable closed STEP before any deck upload', async () => {
  const token = readFileSync(new URL('./fixtures/text-bracket-project.txt', import.meta.url), 'utf8').trim();
  const project = readProjectFromUrl('https://stepbystep.john-steel.com/?projet=' + token)!;
  assert.ok(project);
  const report = checkSheetMetalFeasibility(project.state);
  assert.ok(report.isFeasible, JSON.stringify(report.checks.filter(c => c.status === 'fail')));
  const exporter = loadSource(fileURLToPath(new URL('../api.ts', import.meta.url)));
  const step = await exporter.generateStepFile(project.state);
  console.info('Export:', { bytes: step.length, solids: (step.match(/MANIFOLD_SOLID_BREP/g) || []).length });
  assert.match(step, /MANIFOLD_SOLID_BREP/);
  const solid = await importSTEP(new Blob([step]));
  try {
    assert.ok(isShape3D(solid));
    const analyzer = new (getOC().BRepCheck_Analyzer)(solid.wrapped, true, false, false);
    try { assert.equal(analyzer.IsValid(), true); } finally { analyzer.delete(); }
  } finally { solid.delete(); }
});

test('rotated Oleo TEXT on wing B produces one valid closed solid', async () => {
  const token = readFileSync(new URL('./fixtures/oleo-text-project.txt', import.meta.url), 'utf8').trim();
  const project = readProjectFromUrl('https://stepbystep.john-steel.com/#projet=' + token)!;
  assert.ok(project);
  const exporter = loadSource(fileURLToPath(new URL('../api.ts', import.meta.url)));
  const step = await exporter.generateStepFile(project.state);
  console.info('Oleo export:', { bytes: step.length, solids: (step.match(/MANIFOLD_SOLID_BREP/g) || []).length });
  if (process.env.STEP_DIAGNOSTIC_OUTPUT) writeFileSync(process.env.STEP_DIAGNOSTIC_OUTPUT, step);
  const solid = await importSTEP(new Blob([step]));
  try {
    assert.equal(solid.solids.length, 1, 'Stencil counters must remain connected');
    const analyzer = new (getOC().BRepCheck_Analyzer)(solid.wrapped, true, false, false);
    try { assert.equal(analyzer.IsValid(), true); } finally { analyzer.delete(); }
  } finally { solid.delete(); }
});

for (const [bendCount, legIndex] of [[0, 0], [1, 0], [1, 1], [2, 0], [2, 2]]) {
  test(`STEP preserves asymmetric glyph Y on ${bendCount} bends, wing ${legIndex}`, async () => {
    const state = { ...createDefaultProject(), bendCount };
    const leg = state.legs[legIndex];
    leg.hasHole = true;
    leg.holePositions = [{ dist: 80, offset: 100, shape: 'rect', length: 20, width: 24, diam: 5,
      textCutout: true, contour: [{ x: -10, y: -5 }, { x: 8, y: -3 }, { x: 2, y: 12 }] }];
    const exporter = loadSource(fileURLToPath(new URL('../api.ts', import.meta.url)));
    const step = await exporter.generateStepFile(state);
    const solid = await importSTEP(new Blob([step]));
    try {
      const vertices = solid.mesh().vertices as number[];
      const widths = vertices.filter((_, i) => i % 3 === 2);
      assert.ok(widths.some(z => Math.abs(z - 112) < 1e-5), 'glyph top must remain at offset + local Y');
      assert.ok(!widths.some(z => Math.abs(z - 88) < 1e-5), 'glyph must not be mirrored across its centre');
    } finally { solid.delete(); }
  });
}
