import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { transpileModule, ModuleKind } from 'typescript';
import { createDefaultProject } from '../projectDefaults.ts';

const source = readFileSync(new URL('../hooks/useManufacturingExports.ts', import.meta.url), 'utf8');
const js = transpileModule(source, { compilerOptions: { module: ModuleKind.CommonJS } }).outputText;

function setup({ guided = true, feasible = true, preparationError, uploadError }: {
  guided?: boolean; feasible?: boolean; preparationError?: Error; uploadError?: Error;
} = {}) {
  const calls = { steps: 0, plans: 0, uploads: 0, downloads: 0, redirects: [] as string[], errors: [] as (string | null)[], audit: 0, state: [] as unknown[] };
  const state = createDefaultProject();
  const modules: Record<string, unknown> = {
    react: { useState: (initial: unknown) => [initial, (value: unknown) => calls.state.push(value)] },
    '../deckUpload': { uploadStepToDeck: async (file: File) => { calls.uploads++; assert.equal(file.type, 'application/step'); if (uploadError) throw uploadError; return 'https://www.john-steel.com/fr/module/johnsteel_deck/deck?ids_analysis%5B0%5D=123'; } },
    '../exportDownload': { downloadExport: () => { calls.downloads++; }, createManufacturingArchive: () => new Blob() },
    '../projectSharing': { createProjectLink: () => 'https://stepbystep.john-steel.com/' },
    '../api': { generateStepFile: async (snapshot: unknown) => { calls.steps++; assert.notEqual(snapshot, state); if (preparationError) throw preparationError; return 'ISO-10303-21;'; } },
    '../technicalDrawing': { getExportBaseName: () => 'piece', generateTechnicalDrawing: () => new Blob(['PDF']) },
    '../drawingViews': { captureDrawingViews: async () => { calls.plans++; return {}; } },
  };
  const module = { exports: {} as any };
  new Function('require', 'exports', 'window', 'console', js)((id: string) => {
    assert.ok(id in modules, `Unexpected dependency ${id}`); return modules[id];
  }, module.exports, { location: { href: 'https://stepbystep.john-steel.com/', assign: (url: string) => calls.redirects.push(url) } }, { error: () => {} });
  const hook = module.exports.useManufacturingExports({ state, grainDirection: 'length', guided,
    feasibility: { isFeasible: feasible }, setError: (message: string | null) => calls.errors.push(message),
    setSuccessMsg: () => {}, setShowFeasibilityModal: () => { calls.audit++; } });
  return { hook, calls };
}

test('guided order sends only a frozen STEP and navigates to the validated deck with no PDF', async () => {
  const { hook, calls } = setup();
  await hook.handleSendToDeck();
  assert.equal(calls.steps, 1); assert.equal(calls.uploads, 1);
  assert.equal(calls.plans, 0); assert.equal(calls.downloads, 0);
  assert.equal(calls.redirects.length, 1);
  assert.match(calls.redirects[0], /^https:\/\/www\.john-steel\.com\//);
  assert.equal(calls.state.at(-1), false);
});
test('pro ordering retains its companion PDF without changing guided behavior', async () => {
  const { hook, calls } = setup({ guided: false });
  await hook.handleSendToDeck();
  assert.equal(calls.plans, 1); assert.equal(calls.downloads, 1);
  assert.equal(calls.uploads, 1); assert.equal(calls.redirects.length, 0);
});
test('guided audit download is STEP-only and PDF-only download is disabled', async () => {
  const { hook, calls } = setup();
  await hook.handleDownload();
  assert.equal(calls.steps, 1); assert.equal(calls.downloads, 1);
  assert.equal(calls.plans, 0); assert.equal(calls.uploads, 0);
  await hook.handleDownloadPlan();
  assert.equal(calls.downloads, 1); assert.equal(calls.plans, 0);
  assert.match(calls.errors.at(-1)!, /désactivé en mode guidé/);
});
test('infeasible pieces cannot upload or navigate', async () => {
  const { hook, calls } = setup({ feasible: false });
  await hook.handleSendToDeck();
  assert.equal(calls.steps, 0); assert.equal(calls.uploads, 0); assert.equal(calls.redirects.length, 0);
  assert.equal(calls.audit, 1);
});
test('preparation failures are not mislabeled as network failures', async () => {
  const { hook, calls } = setup({ preparationError: new TypeError('Contour invalide') });
  await hook.handleSendToDeck();
  assert.match(calls.errors.at(-1)!, /Contour invalide/);
  assert.doesNotMatch(calls.errors.at(-1)!, /Connexion/);
  assert.equal(calls.uploads, 0); assert.equal(calls.redirects.length, 0);
});
test('upload failure leaves the editor open and releases the busy state', async () => {
  const { hook, calls } = setup({ uploadError: new TypeError('Failed to fetch') });
  await hook.handleSendToDeck();
  assert.match(calls.errors.at(-1)!, /Connexion au service impossible/);
  assert.equal(calls.redirects.length, 0); assert.equal(calls.state.at(-1), false);
});
