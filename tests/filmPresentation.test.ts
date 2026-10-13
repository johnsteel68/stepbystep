import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { filmStageForSection, nextFilmCoverage } from '../viewer/materials/filmPresentation.ts';

test('film is shown for finish/thickness, never for family or shape selection', () => {
  for (const section of [1, 4, 10, 11]) assert.equal(filmStageForSection(section), 'hidden');
  for (const section of [2, 3]) assert.equal(filmStageForSection(section), 'selection');
  for (const section of [5, 6, 7, 8, 9, 12]) assert.equal(filmStageForSection(section), 'removed');
});

test('leaving thickness smoothly removes film and honours reduced motion', () => {
  let coverage = 1, previous = coverage;
  for (let frame = 0; frame < 90; frame++) {
    coverage = nextFilmCoverage(coverage, 'removed', 1 / 60);
    assert.ok(coverage <= previous && coverage >= 0);
    previous = coverage;
  }
  assert.equal(coverage, 0);
  assert.equal(nextFilmCoverage(1, 'hidden', 1 / 60), 0);
  assert.equal(nextFilmCoverage(1, 'removed', 1 / 60, true), 0);
  assert.equal(nextFilmCoverage(0, 'selection', 1 / 60), 1);
});

test('presentation follows workflow sections and exports have no film layer', () => {
  const app = readFileSync(new URL('../App.tsx', import.meta.url), 'utf8');
  const viewer = readFileSync(new URL('../Viewer.tsx', import.meta.url), 'utf8');
  assert.match(app, /filmStage=\{filmStageForSection\(openStep\)\}/);
  assert.match(viewer, /filmStage = 'hidden'/);
  assert.match(viewer, /!exportOnly && FINISH_TEXTURE_PROFILES\[finish\].protectiveFilm/);
});

test('corner restores pointer picking after hiding and provides a screen-sized drag target', () => {
  const corner = readFileSync(new URL('../viewer/materials/ProtectiveFilmCorner.tsx', import.meta.url), 'utf8');
  assert.match(corner, /raycast=\{interactive \? Mesh.prototype.raycast/);
  assert.match(corner, /beginDrag\(event.nativeEvent\)/);
  assert.match(corner, /Math.hypot\(next.clientX - startX, next.clientY - startY\)/);
  assert.match(corner, /film-grab-handle/);
});
