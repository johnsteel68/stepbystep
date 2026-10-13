import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { transpileModule, ModuleKind, JsxEmit } from 'typescript';
import { createDefaultProject } from '../projectDefaults.ts';
import * as flatLayouts from '../viewer/annotations/flatDimensionLayout.ts';

test('flat chains stay on the same XY datum as the unfolded editor', () => {
  for (const bendCount of [0, 1, 3, 4]) {
    const state = { ...createDefaultProject(), bendCount };
    const length = state.legs.slice(0, bendCount + 1).reduce((sum, leg) => sum + leg.length, 0);
    const layouts = flatLayouts.flatDimensionLayouts(state, length, state.width);
    assert.equal(layouts.length, bendCount + 2);
    layouts.slice(0, -1).forEach((layout, index) => {
      assert.equal(layout.baseStart.x, -length / 2 + index * 300);
      assert.equal(layout.baseStart.y, 150);
      assert.equal(layout.end.x - layout.start.x, 300);
      assert.ok(layout.start.y > 150);
    });
    for (const layout of layouts) for (const point of [layout.baseStart, layout.baseEnd, layout.start, layout.end]) assert.equal(point.z, state.thickness + .4);
    assert.equal(layouts.at(-1)!.end.y - layouts.at(-1)!.start.y, state.width);
  }
});

test('SVG text editor dimensions are flat, pointer-transparent and not perspective transforms', () => {
  const source = readFileSync(new URL('../components/FlatTextDimensions.tsx', import.meta.url), 'utf8');
  const js = transpileModule(source, { compilerOptions: { module: ModuleKind.CommonJS, jsx: JsxEmit.ReactJSX } }).outputText;
  const module = { exports: {} as any }, require = createRequire(import.meta.url);
  new Function('require', 'exports', js)((id: string) => id === '../viewer/annotations/flatDimensionLayout' ? flatLayouts : require(id), module.exports);
  const html = renderToStaticMarkup(createElement(module.exports.default, { state: createDefaultProject(), length: 600, width: 300, zoom: 1 }));
  assert.equal((html.match(/300 mm/g) || []).length, 3);
  assert.match(html, /pointer-events="none"/);
  assert.match(html, /rotate\(-90 /);
  assert.doesNotMatch(html, /matrix3d|perspective|<input|<button/);
});

test('text flat view excludes folded labels and uses its own SVG dimensions', () => {
  const viewer = readFileSync(new URL('../Viewer.tsx', import.meta.url), 'utf8');
  const editor = readFileSync(new URL('../components/TextPlacementView.tsx', import.meta.url), 'utf8');
  assert.match(viewer, /showDimensions=\{!textFlatView &&/);
  assert.match(viewer, /showFlatDimensions=\{showDimensions && !textFlatView\}/);
  assert.match(editor, /<FlatTextDimensions/);
  assert.match(editor, /Cotes à plat/);
});
