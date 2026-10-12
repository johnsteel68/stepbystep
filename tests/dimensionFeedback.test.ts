import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { transpileModule, ModuleKind } from 'typescript';

test('dimension feedback waits for controlled sliders to commit before updating App', () => {
  const source = readFileSync(new URL('../useDimensionFeedback.ts', import.meta.url), 'utf8');
  const js = transpileModule(source, { compilerOptions: { module: ModuleKind.CommonJS } }).outputText;
  const pending = new Map<number, () => void>();
  let timerId = 0;
  let displayed: any = null;
  let cleanup: (() => void) | undefined;
  class Input {
    type = 'range'; valueAsNumber = 90;
    getAttribute() { return 'Angle du pli 1'; }
  }
  const input = new Input();
  let committed = 90;
  const react = {
    useState: () => [null, (value: any) => { displayed = value; input.valueAsNumber = committed; }],
    useRef: (current: any) => ({ current }),
    useEffect: (effect: () => () => void) => { cleanup = effect(); },
  };
  const module = { exports: {} as any };
  // Run the real hook with deterministic timers and an input restored on each
  // parent render, just like a controlled React range. No browser dependencies.
  new Function('require', 'exports', 'HTMLInputElement', 'setTimeout', 'clearTimeout', js)(
    () => react, module.exports, Input,
    (callback: () => void) => { pending.set(++timerId, callback); return timerId; },
    (id: number) => pending.delete(id),
  );
  const hook = module.exports.useDimensionFeedback();
  input.valueAsNumber = 45;
  hook.capture({ type: 'input', target: input });
  assert.equal(displayed, null, 'capture must not rerender before onChange');
  assert.equal(input.valueAsNumber, 45, 'onChange must still see the new angle');
  committed = input.valueAsNumber;
  const first = pending.entries().next().value!;
  pending.delete(first[0]); first[1]();
  assert.deepEqual(displayed, { label: 'Angle du pli 1', value: 45, unit: '°' });
  // A second edit must not restore the previous angle either.
  input.valueAsNumber = 120;
  hook.capture({ type: 'input', target: input });
  assert.equal(input.valueAsNumber, 120);
  cleanup?.();
  assert.equal(pending.size, 0, 'unmount cancels feedback and expiry timers');
});
