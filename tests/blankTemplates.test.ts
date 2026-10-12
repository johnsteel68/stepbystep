import assert from 'node:assert/strict';
import test from 'node:test';
import { configureBlankTemplate, templateSettings, removeFrameOpening } from '../blankTemplates.ts';
import { createDefaultProject } from '../projectDefaults.ts';
import { normalizeFormedBlank } from '../formedBlank.ts';
import { createDrawingModel } from '../technicalDrawing.ts';
import { createProjectLink, readProjectFromUrl } from '../projectSharing.ts';

test('leaving the frame removes its opening and preserves additional holes', () => {
  const frame = configureBlankTemplate({ ...createDefaultProject(), bendCount: 0, blankShape: 'frame', blankLength: 100, blankWidth: 100 });
  const cleared = removeFrameOpening(frame);
  assert.equal(cleared.legs[0].hasHole, false);
  assert.deepEqual(cleared.legs[0].holePositions, []);
  const manual = { shape: 'round' as const, dist: 5, offset: 5, diam: 3 };
  const edited = { ...frame, legs: frame.legs.map((leg, index) => index ? leg : { ...leg, holePositions: [...leg.holePositions!, manual] }) };
  assert.deepEqual(removeFrameOpening(edited).legs[0].holePositions, [manual]);
  assert.equal(removeFrameOpening(edited).legs[0].hasHole, true);
  const rectangle = { ...edited, blankShape: 'rectangle' as const };
  assert.equal(removeFrameOpening(rectangle), rectangle);
});

test('leaving a mounting plate removes preset holes, preserving manual holes after edits and sharing', () => {
  const plate = configureBlankTemplate({ ...createDefaultProject(), bendCount: 0, blankShape: 'mounting-plate', blankLength: 100, blankWidth: 100 }, { centralDiameter: 20 });
  assert.equal(removeFrameOpening(plate).legs[0].hasHole, false);
  const manual = { shape: 'round' as const, dist: 30, offset: 30, diam: 5 };
  plate.legs[0].holePositions = [manual, ...plate.legs[0].holePositions!.slice(1)];
  const restored = readProjectFromUrl(createProjectLink(plate, 'length'))!.state;
  assert.deepEqual(removeFrameOpening(restored).legs[0].holePositions, [manual]);
  const legacy = configureBlankTemplate({ ...plate, legs: createDefaultProject().legs }, { centralDiameter: 20 });
  legacy.legs[0].holePositions = legacy.legs[0].holePositions!.map(({ templateOrigin, ...hole }) => hole);
  assert.equal(removeFrameOpening(legacy).legs[0].hasHole, false);
});
for (const shape of ['frame', 'mounting-plate'] as const) test(shape + ' keeps editable cutouts in the PDF and shared project', () => {
  const state = normalizeFormedBlank(configureBlankTemplate({ ...createDefaultProject(), bendCount: 0, blankShape: shape, blankLength: 100, blankWidth: 80 },
    { border: 10, diameter: 5, margin: 10, centralDiameter: 20 }));
  const holes = state.legs[0].holePositions!;
  assert.equal(holes.length, shape === 'frame' ? 1 : 5);
  if (shape === 'frame') assert.deepEqual([holes[0].length, holes[0].width], [80, 60]);
  else assert.deepEqual(holes.map(p => [p.dist, p.offset]), [[10, 10], [10, 70], [90, 10], [90, 70], [50, 40]]);
  const drawing = createDrawingModel(state);
  assert.equal(drawing.wings[0].holes.length, holes.length);
  const restored = readProjectFromUrl(createProjectLink(state, 'length'))!;
  assert.deepEqual(restored.state.legs[0].holePositions, holes);
  const resized = configureBlankTemplate(state, { length: 120, width: 100 });
  assert.equal(templateSettings(resized).length, 120);
  assert.equal(templateSettings(resized).width, 100);
});
test('templates reject overlapping cutouts and insufficient material', () => {
  const state = { ...createDefaultProject(), bendCount: 0, blankShape: 'mounting-plate' as const, blankLength: 100, blankWidth: 100 };
  assert.throws(() => configureBlankTemplate(state, { diameter: 20, margin: 10 }));
  assert.throws(() => configureBlankTemplate(state, { centralDiameter: 99 }));
  assert.throws(() => configureBlankTemplate({ ...state, blankShape: 'frame' }, { border: 50 }));
  assert.equal(configureBlankTemplate(state, { centralDiameter: 0 }).legs[0].holePositions!.length, 4);
});
