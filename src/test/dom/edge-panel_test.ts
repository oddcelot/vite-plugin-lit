import {afterEach, beforeAll, expect, test, vi} from 'vite-plus/test';
import {observeEdgeInsets} from '../../lib/runtime/edge-panel.js';
import type {EdgeInsets} from '../../lib/runtime/edge-panel.js';

beforeAll(() => {
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
});

let dispose: (() => void) | undefined;

afterEach(() => {
  dispose?.();
  dispose = undefined;
  document.body.replaceChildren();
});

/** A dock host whose edge panel occupies `rect` in a 1000×640 viewport. */
const mountDock = (
  host: string,
  panelId: string,
  rect: {left: number; top: number; width: number; height: number}
) => {
  Object.defineProperty(document.documentElement, 'clientWidth', {
    configurable: true,
    value: 1000,
  });
  Object.defineProperty(document.documentElement, 'clientHeight', {
    configurable: true,
    value: 640,
  });
  const el = document.createElement(host);
  const panel = document.createElement('div');
  panel.id = panelId;
  panel.getBoundingClientRect = () =>
    ({
      ...rect,
      right: rect.left + rect.width,
      bottom: rect.top + rect.height,
    }) as DOMRect;
  el.attachShadow({mode: 'open'}).append(panel);
  document.body.append(el);
};

const insetsAfterMount = async (): Promise<EdgeInsets> => {
  const seen: EdgeInsets[] = [];
  dispose = observeEdgeInsets((insets) => seen.push(insets));
  await vi.waitFor(() => expect(seen.length).toBeGreaterThan(0));
  return seen.at(-1)!;
};

test('clears the devframes bottom edge toolbar', async () => {
  mountDock('devframes-dock-embedded', 'devframes-edge-panel', {
    left: 0,
    top: 600,
    width: 1000,
    height: 40,
  });
  // 40px of toolbar plus the 12px gap.
  expect(await insetsAfterMount()).toEqual({
    top: 0,
    right: 0,
    bottom: 52,
    left: 0,
  });
});

test('still finds the pre-devframes dock', async () => {
  mountDock('vite-devtools-dock-embedded', 'vite-devtools-edge-panel', {
    left: 0,
    top: 0,
    width: 1000,
    height: 40,
  });
  expect((await insetsAfterMount()).top).toBe(52);
});

test('a collapsed toolbar pill in the corner needs no room', async () => {
  mountDock('devframes-dock-embedded', 'devframes-edge-panel', {
    left: 8,
    top: 592,
    width: 40,
    height: 40,
  });
  expect(await insetsAfterMount()).toEqual({
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
  });
});
