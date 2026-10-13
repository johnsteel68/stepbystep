import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { transpileModule, ModuleKind, JsxEmit } from 'typescript';
import { renderToStaticMarkup } from 'react-dom/server';
import * as sheet from '../sheetGeometry.ts';
import * as textures from '../viewer/materials/textureCatalog.ts';

const require = createRequire(import.meta.url);
const source = readFileSync(new URL('../components/MaterialControls.tsx', import.meta.url), 'utf8');
const js = transpileModule(source, { compilerOptions: { module: ModuleKind.CommonJS, jsx: JsxEmit.ReactJSX } }).outputText;
const componentModule = { exports: {} as any };
new Function('require', 'exports', js)((id: string) => id === '../sheetGeometry' ? sheet
  : id === '../viewer/materials/textureCatalog' ? textures : require(id), componentModule.exports);

test('horizontal material cards retain three labelled radio choices and one selection', () => {
  let selected: string | undefined;
  const tree = componentModule.exports.MaterialControls({ value: 'Steel', bendCount: 3, onChange: (id: string) => { selected = id; } });
  const html = renderToStaticMarkup(tree);
  assert.equal((html.match(/type="radio"/g) || []).length, 3);
  assert.equal((html.match(/checked=""/g) || []).length, 1);
  assert.match(html, /Matière de la pièce/);
  for (const label of ['Acier', 'Inox', 'Aluminium']) assert.ok(html.includes(label));
  tree.props.children[1][1].props.children[0].props.onChange();
  assert.equal(selected, 'Stainless');
});

test('material cards use a full-width row layout at desktop and mobile sizes', () => {
  const css = readFileSync(new URL('../index.css', import.meta.url), 'utf8');
  assert.match(css, /\.material-options \{[^}]*grid-template-columns: minmax\(0,1fr\)/);
  assert.doesNotMatch(css, /\.material-options \{[^}]*repeat\(3/);
  assert.match(css, /\.material-option \{[^}]*grid-template-columns: 40px minmax\(0,1fr\) 18px/);
  assert.match(css, /\.material-option \{[^}]*grid-template-columns: 28px minmax\(0,1fr\) 18px; min-height: 44px/);
  assert.match(css, /\.material-option:has\(input:focus-visible\)/);
});
