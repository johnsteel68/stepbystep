import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { transpileModule, ModuleKind, JsxEmit } from 'typescript';
import { renderToStaticMarkup } from 'react-dom/server';

const require = createRequire(import.meta.url);
const source = readFileSync(new URL('../components/OrderButton.tsx', import.meta.url), 'utf8');
const js = transpileModule(source, { compilerOptions: { module: ModuleKind.CommonJS, jsx: JsxEmit.ReactJSX } }).outputText;
const componentModule = { exports: {} as any };
new Function('require', 'exports', js)(require, componentModule.exports);
const OrderButton = componentModule.exports.default;

test('the only primary CTA invokes the deck action and has the requested label', () => {
  let sent = 0;
  const button = OrderButton({ busy: false, feasible: true, onOrder: () => { sent++; } });
  assert.equal(button.type, 'button');
  assert.equal(button.props.disabled, false);
  button.props.onClick();
  assert.equal(sent, 1);
  const html = renderToStaticMarkup(button);
  assert.match(html, /Commander ma pièce/);
  assert.equal((html.match(/<button/g) || []).length, 1);
  assert.doesNotMatch(html, /Télécharger|Envoyer dans le deck/);
});
test('preparation prevents repeat clicks and exposes accessible busy feedback', () => {
  const button = OrderButton({ busy: true, feasible: true, onOrder: () => {} });
  assert.equal(button.props.disabled, true);
  assert.equal(button.props['aria-busy'], true);
  assert.match(renderToStaticMarkup(button), /Préparation de votre pièce/);
});
test('an unmanufacturable part cannot be ordered', () => {
  const button = OrderButton({ busy: false, feasible: false, onOrder: () => {} });
  assert.equal(button.props.disabled, true);
  assert.match(button.props.title, /fabricabilité/);
});
test('the order section no longer offers separate PDF download or deck upload buttons', () => {
  const app = readFileSync(new URL('../App.tsx', import.meta.url), 'utf8');
  const section = app.slice(app.indexOf('{/* 9. COMMANDER */}'), app.indexOf('{/* Main 3D Viewport */}'));
  assert.match(section, /<OrderButton onOrder=\{handleSendToDeck\}/);
  assert.doesNotMatch(section, /onClick=\{handleDownload(?:Plan)?\}|Envoyer dans le deck|Retélécharger|Télécharger le plan PDF/);
  assert.match(section, /href=\{readyDeck.url\}/);
  assert.match(section, /stepDownloadUnlocked/);
  assert.match(section, /onClick=\{handleDownloadStep\}/);
});
