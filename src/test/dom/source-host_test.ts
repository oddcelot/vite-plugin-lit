import {afterEach, describe, expect, test, vi} from 'vite-plus/test';
import {
  defaultResolver,
  findSourceAtPoint,
  findSourceHost,
} from '../../lib/runtime/source-overlay/source-host.js';
import {SOURCE_META_KEY} from '../../lib/runtime/source-meta.js';

let counter = 0;

/** Defines a component carrying source metadata (or not); returns its tag. */
const define = (withMeta = true, name = 'Comp'): string => {
  const tag = `x-host-${counter++}`;
  class El extends HTMLElement {}
  if (withMeta) {
    (El as unknown as Record<symbol, unknown>)[SOURCE_META_KEY] = {
      filePath: '/src/comp.ts',
      lineNumber: 12,
      componentName: name,
    };
  }
  customElements.define(tag, El);
  return tag;
};

const setRect = (
  el: Element,
  r: {left: number; top: number; right: number; bottom: number}
) => {
  el.getBoundingClientRect = () => r as DOMRect;
};

const noHit = () =>
  vi.spyOn(document, 'elementFromPoint').mockReturnValue(null);

afterEach(() => {
  vi.restoreAllMocks();
  document.body.innerHTML = '';
});

describe('findSourceHost', () => {
  test('returns the element itself when it carries metadata', () => {
    const host = document.createElement(define());
    document.body.append(host);
    expect(findSourceHost(host)).toBe(host);
  });

  test('walks up light-DOM ancestors', () => {
    const host = document.createElement(define());
    const inner = document.createElement('span');
    host.append(inner);
    document.body.append(host);
    expect(findSourceHost(inner)).toBe(host);
  });

  test('crosses shadow boundaries to the rendering component', () => {
    const host = document.createElement(define());
    const root = host.attachShadow({mode: 'open'});
    const wrapper = document.createElement('div');
    const leaf = document.createElement('b');
    wrapper.append(leaf);
    root.append(wrapper);
    document.body.append(host);
    expect(findSourceHost(leaf)).toBe(host);
  });

  test('picks the nearest of nested components', () => {
    const outer = document.createElement(define());
    const inner = document.createElement(define());
    const root = outer.attachShadow({mode: 'open'});
    root.append(inner);
    document.body.append(outer);
    expect(findSourceHost(inner)).toBe(inner);
  });

  test('returns null when nothing up the chain has metadata', () => {
    const plain = document.createElement(define(false));
    const child = document.createElement('i');
    plain.append(child);
    document.body.append(plain);
    expect(findSourceHost(child)).toBeNull();
  });
});

describe('findSourceAtPoint', () => {
  test('resolves via elementFromPoint, piercing shadow roots', () => {
    const host = document.createElement(define());
    const root = host.attachShadow({mode: 'open'});
    const deep = document.createElement('p');
    root.append(deep);
    document.body.append(host);
    vi.spyOn(document, 'elementFromPoint').mockReturnValue(host);
    root.elementFromPoint = () => deep;
    expect(findSourceAtPoint(5, 5)).toBe(host);
  });

  test('falls back to bounding rects when the hit test finds no host', () => {
    const host = document.createElement(define());
    setRect(host, {left: 0, top: 0, right: 100, bottom: 100});
    document.body.append(host);
    noHit();
    expect(findSourceAtPoint(50, 50)).toBe(host);
    expect(findSourceAtPoint(500, 500)).toBeNull();
  });

  test('the rect fallback prefers the deepest matching host', () => {
    const outer = document.createElement(define());
    const inner = document.createElement(define());
    outer.append(inner);
    for (const el of [outer, inner]) {
      setRect(el, {left: 0, top: 0, right: 100, bottom: 100});
    }
    document.body.append(outer);
    noHit();
    expect(findSourceAtPoint(10, 10)).toBe(inner);
  });

  test('the rect fallback ignores elements without metadata', () => {
    const plain = document.createElement(define(false));
    setRect(plain, {left: 0, top: 0, right: 100, bottom: 100});
    document.body.append(plain);
    noHit();
    expect(findSourceAtPoint(10, 10)).toBeNull();
  });

  test('closes the dialog for the hit test and reopens it after', () => {
    const dialog = document.createElement('dialog');
    document.body.append(dialog);
    dialog.showModal();
    const seenOpen: boolean[] = [];
    vi.spyOn(document, 'elementFromPoint').mockImplementation(() => {
      seenOpen.push(dialog.open);
      return null;
    });
    findSourceAtPoint(1, 1, dialog);
    expect(seenOpen).toEqual([false]);
    expect(dialog.open).toBe(true);
  });
});

describe('defaultResolver', () => {
  test('describes the host from its source metadata', async () => {
    const tag = define(true, 'Widget');
    const host = document.createElement(tag);
    const inner = document.createElement('span');
    host.append(inner);
    document.body.append(host);
    expect(await defaultResolver.resolveElementInfo(inner)).toEqual({
      tagName: tag,
      componentName: 'Widget',
      source: {filePath: '/src/comp.ts', lineNumber: 12},
    });
  });

  test('resolves to null with no host', async () => {
    const el = document.createElement('div');
    document.body.append(el);
    expect(await defaultResolver.resolveElementInfo(el)).toBeNull();
  });
});
