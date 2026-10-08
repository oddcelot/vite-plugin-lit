import {
  afterEach,
  beforeEach,
  describe,
  expect,
  test,
  vi,
} from 'vite-plus/test';
import {
  clearHighlight,
  highlightAll,
  highlightById,
  MAX_OUTLINES,
  revealById,
  showHighlight,
} from '../../lib/runtime/inspector/highlight.js';
import {idOf} from '../../lib/runtime/timeline/identity.js';

const rectOf = (
  el: Element,
  r: {l: number; t: number; w: number; h: number}
) => {
  el.getBoundingClientRect = () =>
    ({left: r.l, top: r.t, width: r.w, height: r.h}) as DOMRect;
};

const box = () =>
  document.querySelector<HTMLElement>('[data-lit-devtools-highlight]');

let target: HTMLElement;

beforeEach(() => {
  target = document.createElement('div');
  rectOf(target, {l: 10, t: 20, w: 100, h: 50});
  document.body.append(target);
});

afterEach(() => {
  // Hide rather than remove: the module caches its box.
  clearHighlight();
  target.remove();
});

describe('showHighlight', () => {
  test('lays a fixed, click-through box over the element rect', () => {
    showHighlight(target);
    const el = box()!;
    expect(el.style.display).toBe('block');
    expect(el.style.left).toBe('10px');
    expect(el.style.top).toBe('20px');
    expect(el.style.width).toBe('100px');
    expect(el.style.height).toBe('50px');
    expect(el.style.position).toBe('fixed');
    expect(el.style.pointerEvents).toBe('none');
  });

  test('reuses one box and follows the next element', () => {
    showHighlight(target);
    const other = document.createElement('div');
    rectOf(other, {l: 1, t: 2, w: 3, h: 4});
    document.body.append(other);
    showHighlight(other);
    expect(
      document.querySelectorAll('[data-lit-devtools-highlight]')
    ).toHaveLength(1);
    expect(box()!.style.left).toBe('1px');
    expect(box()!.style.height).toBe('4px');
    other.remove();
  });
});

describe('clearHighlight', () => {
  test('is safe before any box exists and hides it afterwards', () => {
    expect(() => clearHighlight()).not.toThrow();
    showHighlight(target);
    clearHighlight();
    expect(box()!.style.display).toBe('none');
  });
});

describe('highlightById', () => {
  test('outlines the element with that id', () => {
    highlightById(idOf(target));
    expect(box()!.style.display).toBe('block');
    expect(box()!.style.width).toBe('100px');
  });

  test('clears for null', () => {
    highlightById(idOf(target));
    highlightById(null);
    expect(box()!.style.display).toBe('none');
  });

  test('clears when the id does not resolve', () => {
    highlightById(idOf(target));
    highlightById(987654321);
    expect(box()!.style.display).toBe('none');
  });
});

describe('revealById', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  test('scrolls the element to the middle and outlines it until the scroll settles', () => {
    vi.useFakeTimers({toFake: ['requestAnimationFrame', 'performance']});
    const scrolled: ScrollIntoViewOptions[] = [];
    target.scrollIntoView = (opts) => {
      scrolled.push(opts as ScrollIntoViewOptions);
    };
    revealById(idOf(target));
    expect(scrolled).toEqual([
      expect.objectContaining({block: 'center', inline: 'nearest'}),
    ]);
    expect(box()!.style.display).toBe('block');
    // The box follows the element while it moves.
    rectOf(target, {l: 10, t: 300, w: 100, h: 50});
    vi.advanceTimersByTime(100);
    expect(box()!.style.top).toBe('300px');
    vi.advanceTimersByTime(2000);
    expect(box()!.style.display).toBe('none');
  });

  test('ignores an id that does not resolve', () => {
    expect(() => revealById(987654321)).not.toThrow();
  });
});

describe('highlightAll', () => {
  const shown = () =>
    [
      ...document.querySelectorAll<HTMLElement>(
        '[data-lit-devtools-highlight-all]'
      ),
    ].filter((b) => b.style.display === 'block');

  const sized = (l: number) => {
    const el = document.createElement('div');
    rectOf(el, {l, t: 0, w: 10, h: 10});
    document.body.append(el);
    return el;
  };

  test('outlines every element that resolves and has a size', () => {
    const a = sized(1);
    const b = sized(2);
    const hidden = document.createElement('div');
    rectOf(hidden, {l: 0, t: 0, w: 0, h: 0});
    document.body.append(hidden);
    expect(highlightAll([idOf(a), idOf(hidden), 999_999, idOf(b)])).toBe(2);
    expect(shown().map((x) => x.style.left)).toEqual(['1px', '2px']);
    a.remove();
    b.remove();
    hidden.remove();
  });

  test('a single highlight replaces the set, and the set replaces it', () => {
    const a = sized(1);
    highlightAll([idOf(a)]);
    showHighlight(target);
    expect(shown()).toHaveLength(0);
    expect(box()!.style.display).toBe('block');
    highlightAll([idOf(a)]);
    expect(box()!.style.display).toBe('none');
    expect(shown()).toHaveLength(1);
    a.remove();
  });

  test('a shorter list hides the boxes it no longer needs', () => {
    const els = [sized(1), sized(2), sized(3)];
    highlightAll(els.map(idOf));
    highlightAll([idOf(els[0]!)]);
    expect(shown()).toHaveLength(1);
    clearHighlight();
    expect(shown()).toHaveLength(0);
    for (const el of els) el.remove();
  });

  test('stops at the cap', () => {
    const els = Array.from({length: MAX_OUTLINES + 3}, (_, i) => sized(i));
    expect(highlightAll(els.map(idOf))).toBe(MAX_OUTLINES);
    for (const el of els) el.remove();
  });
});
