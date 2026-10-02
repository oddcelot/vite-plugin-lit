import {afterEach, expect, test} from 'vite-plus/test';
import '../../panel/timeline-layers.js';
import type {LayerState} from '../../panel/timeline-layers.js';

const layers: LayerState[] = [
  {id: 'lit-lifecycle', label: 'Lifecycle', color: 0xff0000, enabled: true},
  {id: 'mouse', label: 'Mouse', color: 0x00ff00, enabled: false},
];

const mount = async (props: {layers: LayerState[]; caption?: string}) => {
  const el = document.createElement('timeline-layers');
  Object.assign(el, props);
  document.body.append(el);
  await el.updateComplete;
  return {el, buttons: [...el.shadowRoot!.querySelectorAll('wa-button')]};
};

afterEach(() => {
  document.body.replaceChildren();
});

test('one pill per layer, marked on when enabled', async () => {
  const {buttons} = await mount({layers});
  expect(buttons.map((b) => b.textContent!.trim())).toEqual([
    'Lifecycle',
    'Mouse',
  ]);
  expect(buttons.map((b) => b.classList.contains('on'))).toEqual([true, false]);
  expect(buttons[0]!.title).toBe('Hide Lifecycle');
  expect(buttons[1]!.title).toBe('Show Mouse');
});

test('a click asks the view to toggle that layer', async () => {
  const {buttons} = await mount({layers});
  const toggled: string[] = [];
  // Composed and bubbling, so the view hears it from outside the shadow root.
  document.body.addEventListener('layer-toggle', (e) =>
    toggled.push((e as CustomEvent<{id: string}>).detail.id)
  );
  buttons[1]!.click();
  expect(toggled).toEqual(['mouse']);
});

test('the caption labels the strip only when set', async () => {
  const plain = await mount({layers});
  expect(plain.el.shadowRoot!.querySelector('.caption')).toBeNull();
  const tracks = await mount({layers, caption: 'Tracks'});
  expect(tracks.el.shadowRoot!.querySelector('.caption')?.textContent).toBe(
    'Tracks'
  );
});
