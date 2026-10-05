import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
  vi,
} from 'vite-plus/test';
import {SOURCE_META_KEY} from '../../lib/runtime/source-meta.js';
import type {ElementInfo} from '../../lib/types.js';

type OverlayModule =
  typeof import('../../lib/runtime/source-overlay/overlay-element.js');

/** The overlay's shadow root is closed; capture it as it is attached. */
let lastRoot: ShadowRoot | undefined;
const realAttachShadow = Reflect.get(
  Element.prototype,
  'attachShadow'
) as Element['attachShadow'];
let mod: OverlayModule;

beforeAll(async () => {
  Element.prototype.attachShadow = function (init: ShadowRootInit) {
    const root = realAttachShadow.call(this, init);
    if (this.localName === 'lit-source-overlay') lastRoot = root;
    return root;
  };
  if (typeof globalThis.ResizeObserver === 'undefined') {
    globalThis.ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    };
  }
  mod = await import('../../lib/runtime/source-overlay/overlay-element.js');
});

let counter = 0;
const RECT = {left: 20, top: 30, width: 100, height: 40};

/** A component with source metadata whose rect is fixed and whose hit test succeeds. */
const makeTarget = (name = 'Card') => {
  const tag = `x-target-${counter++}`;
  class El extends HTMLElement {}
  (El as unknown as Record<symbol, unknown>)[SOURCE_META_KEY] = {
    filePath: '/ws/src/card.ts',
    lineNumber: 7,
    componentName: name,
  };
  customElements.define(tag, El);
  const el = document.createElement(tag);
  el.getBoundingClientRect = () =>
    ({
      ...RECT,
      right: RECT.left + RECT.width,
      bottom: RECT.top + RECT.height,
    }) as DOMRect;
  document.body.append(el);
  return {tag, el};
};

const shadow = () => lastRoot!;
const byId = (id: string) => shadow().getElementById(id)!;
const dialog = () => byId('overlay') as HTMLDialogElement;

let overlay: InstanceType<typeof HTMLElement> & {
  configure(o: Record<string, unknown>): void;
  activate(): void;
  deactivate(): void;
  toggle(): void;
};

const mount = (options: Record<string, unknown> = {}) => {
  overlay = document.createElement(
    'lit-source-overlay'
  ) as unknown as typeof overlay;
  overlay.configure(options);
  document.body.append(overlay);
};

const hover = async (x = 40, y = 40) => {
  document.dispatchEvent(
    new MouseEvent('mousemove', {clientX: x, clientY: y, bubbles: true})
  );
  await vi.advanceTimersByTimeAsync(100);
};

const key = (init: KeyboardEventInit) => {
  const e = new KeyboardEvent('keydown', {
    bubbles: true,
    cancelable: true,
    ...init,
  });
  document.body.dispatchEvent(e);
  return e;
};

const click = (init: MouseEventInit = {}) => {
  const e = new MouseEvent('click', {
    bubbles: true,
    cancelable: true,
    clientX: 40,
    clientY: 40,
    ...init,
  });
  document.body.dispatchEvent(e);
  return e;
};

let hitTarget: Element | null;
const realElementFromPoint = Reflect.get(
  document,
  'elementFromPoint'
) as Document['elementFromPoint'];

beforeEach(() => {
  vi.useFakeTimers();
  hitTarget = null;
  document.elementFromPoint = () => hitTarget;
});

afterEach(() => {
  overlay?.remove();
  document.elementFromPoint = realElementFromPoint;
  document.body.innerHTML = '';
  document.head.innerHTML = '';
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('registration', () => {
  test('defines lit-source-overlay and builds its dialog', () => {
    expect(customElements.get('lit-source-overlay')).toBeDefined();
    mount();
    expect(dialog().open).toBe(false);
  });

  test('initSourceOverlay appends a configured overlay to the body', () => {
    mod.initSourceOverlay({});
    expect(document.querySelectorAll('lit-source-overlay')).toHaveLength(1);
    document.querySelector('lit-source-overlay')!.remove();
  });

  test('toggleSourceOverlay flips the mounted overlay', () => {
    mount();
    mod.toggleSourceOverlay();
    expect(dialog().open).toBe(true);
    mod.toggleSourceOverlay();
    expect(dialog().open).toBe(false);
  });
});

describe('activate and deactivate', () => {
  test('activate opens the modal and forces a crosshair cursor', () => {
    mount();
    overlay.activate();
    expect(dialog().open).toBe(true);
    expect(document.head.textContent).toContain('cursor:crosshair');
  });

  test('deactivate closes the modal, removes the cursor and target UI', async () => {
    const {el} = makeTarget();
    hitTarget = el;
    mount();
    overlay.activate();
    await hover();
    expect(byId('tooltip').style.display).toBe('flex');

    overlay.deactivate();
    expect(dialog().open).toBe(false);
    expect(document.head.textContent).not.toContain('crosshair');
    expect(byId('tooltip').style.display).toBe('none');
    expect(byId('highlight').style.display).toBe('none');
  });

  test('activate twice is harmless', () => {
    mount();
    overlay.activate();
    overlay.activate();
    expect(document.head.querySelectorAll('style')).toHaveLength(1);
  });

  test('removing the overlay deactivates it', () => {
    mount();
    overlay.activate();
    overlay.remove();
    expect(dialog().open).toBe(false);
  });
});

describe('hover', () => {
  test('outlines the component under the pointer and shows its source', async () => {
    const {tag, el} = makeTarget();
    hitTarget = el;
    mount({workspaceRoot: '/ws'});
    overlay.activate();
    await hover();

    const hl = byId('highlight');
    expect(hl.style.display).toBe('block');
    expect(hl.style.left).toBe('20px');
    expect(hl.style.top).toBe('30px');
    expect(hl.style.width).toBe('100px');
    expect(hl.style.height).toBe('40px');
    expect(byId('mask').style.clipPath).toContain('path(');
    expect(byId('tag').textContent).toBe(`<${tag}>`);
    expect(byId('path').textContent).toBe('src/card.ts:7');
  });

  test('moving onto a non-component clears the target', async () => {
    const {el} = makeTarget();
    hitTarget = el;
    mount();
    overlay.activate();
    await hover();
    expect(byId('highlight').style.display).toBe('block');

    // Neither the hit test nor the rect fallback finds a host any more.
    el.getBoundingClientRect = () =>
      ({left: 0, top: 0, right: 0, bottom: 0}) as DOMRect;
    hitTarget = document.createElement('p');
    await hover(900, 900);
    expect(byId('highlight').style.display).toBe('none');
    expect(byId('tooltip').style.display).toBe('none');
  });

  test('ignores elements rejected by the exclude option', async () => {
    const {el} = makeTarget();
    hitTarget = el;
    mount({exclude: (e: Element) => e === el});
    overlay.activate();
    await hover();
    expect(byId('highlight').style.display).toBe('none');
  });

  test('throttles: many moves inside the window resolve once, at the latest point', async () => {
    const {el} = makeTarget();
    const spy = vi.fn(() => el);
    document.elementFromPoint = spy;
    mount({throttleMs: 50});
    overlay.activate();
    spy.mockClear();

    for (const x of [1, 2, 3]) {
      document.dispatchEvent(
        new MouseEvent('mousemove', {clientX: x, clientY: x, bubbles: true})
      );
    }
    await vi.advanceTimersByTimeAsync(60);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith(3, 3);
  });

  test('does nothing while inactive', async () => {
    const {el} = makeTarget();
    hitTarget = el;
    mount();
    await hover();
    expect(byId('tooltip').style.display).toBe('');
  });
});

describe('click', () => {
  test('selects the hovered component, swallows the click and exits', async () => {
    const {tag, el} = makeTarget();
    hitTarget = el;
    const onSelect = vi.fn<(info: ElementInfo) => void>();
    mount({onSelect});
    overlay.activate();
    await hover();

    const pageClick = vi.fn();
    window.addEventListener('click', pageClick);
    const e = click();
    window.removeEventListener('click', pageClick);

    expect(e.defaultPrevented).toBe(true);
    expect(pageClick).not.toHaveBeenCalled();
    expect(onSelect).toHaveBeenCalledWith({
      tagName: tag,
      componentName: 'Card',
      source: {filePath: '/ws/src/card.ts', lineNumber: 7},
    });
    expect(dialog().open).toBe(false);
  });

  test('a click before anything is resolved passes through', async () => {
    mount();
    overlay.activate();
    const e = click();
    expect(e.defaultPrevented).toBe(false);
    expect(dialog().open).toBe(true);
  });

  test('ctrl-click opens the source through the dev server endpoint', async () => {
    const {el} = makeTarget();
    hitTarget = el;
    const fetchMock = vi.fn(async () => ({ok: true}));
    vi.stubGlobal('fetch', fetchMock);
    mount({workspaceRoot: '/ws', editor: 'vscode'});
    overlay.activate();
    await hover();
    click({ctrlKey: true});
    await vi.advanceTimersByTimeAsync(0);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const url = new URL(
      (fetchMock.mock.calls[0] as unknown as [string])[0],
      'http://localhost'
    );
    expect(url.pathname).toBe('/__lit-open-in-editor');
    expect(url.searchParams.get('file')).toBe('src/card.ts');
    expect(url.searchParams.get('line')).toBe('7');
    expect(url.searchParams.get('editor')).toBe('vscode');
    expect(dialog().open).toBe(false);
  });

  test('the tooltip takes no pointer events and its icons are decorative', async () => {
    const {el} = makeTarget();
    el.setAttribute('data-lit-source', '/ws/src/page.ts:12:5');
    hitTarget = el;
    mount({workspaceRoot: '/ws'});
    overlay.activate();
    await hover();
    // The pointer goes through to the page, so no tooltip hit-testing is needed.
    const css = shadow().querySelector('style')!.textContent!;
    expect(css).toMatch(/#tooltip\s*{[^}]*pointer-events:\s*none/);
    for (const id of ['open', 'site-open']) {
      const icon = byId(id);
      expect(icon.tagName).toBe('SPAN');
      expect(icon.getAttribute('aria-hidden')).toBe('true');
      expect(icon.hasAttribute('title')).toBe(false);
      expect(icon.hasAttribute('aria-label')).toBe(false);
    }
  });
});

describe('call site', () => {
  const SITE = '/ws/src/page.ts:12:5';

  const urlOf = (fetchMock: {mock: {calls: unknown[]}}, i = 0) =>
    new URL((fetchMock.mock.calls[i] as [string])[0], 'http://localhost');

  test('shows the row with the call site, and hides it without one', async () => {
    const plain = makeTarget();
    const stamped = makeTarget();
    stamped.el.setAttribute('data-lit-source', SITE);
    mount({workspaceRoot: '/ws'});
    overlay.activate();

    hitTarget = plain.el;
    await hover();
    expect(byId('site-row').style.display).toBe('none');

    hitTarget = stamped.el;
    await hover(41, 41);
    expect(byId('site-row').style.display).toBe('');
    expect(byId('site-text').textContent).toBe('src/page.ts:12');
  });

  test('Cmd+Shift+click opens the call site with its column', async () => {
    const {el} = makeTarget();
    el.setAttribute('data-lit-source', SITE);
    hitTarget = el;
    const fetchMock = vi.fn(async () => ({ok: true}));
    vi.stubGlobal('fetch', fetchMock);
    const onSelect = vi.fn();
    mount({workspaceRoot: '/ws', onSelect});
    overlay.activate();
    await hover();
    click({metaKey: true, shiftKey: true});
    await vi.advanceTimersByTimeAsync(0);

    const url = urlOf(fetchMock);
    expect(url.searchParams.get('file')).toBe('src/page.ts');
    expect(url.searchParams.get('line')).toBe('12');
    expect(url.searchParams.get('column')).toBe('5');
    expect(onSelect.mock.calls[0]![0].callSite).toEqual({
      filePath: '/ws/src/page.ts',
      lineNumber: 12,
      columnNumber: 5,
    });
  });

  test('Ctrl+click still opens the declaration, without a column', async () => {
    const {el} = makeTarget();
    el.setAttribute('data-lit-source', SITE);
    hitTarget = el;
    const fetchMock = vi.fn(async () => ({ok: true}));
    vi.stubGlobal('fetch', fetchMock);
    mount({workspaceRoot: '/ws'});
    overlay.activate();
    await hover();
    click({ctrlKey: true});
    await vi.advanceTimersByTimeAsync(0);
    const url = urlOf(fetchMock);
    expect(url.searchParams.get('file')).toBe('src/card.ts');
    expect(url.searchParams.has('column')).toBe(false);
  });

  test('Cmd+Shift+click falls back to the declaration without a call site', async () => {
    const {el} = makeTarget();
    hitTarget = el;
    const fetchMock = vi.fn(async () => ({ok: true}));
    vi.stubGlobal('fetch', fetchMock);
    mount({workspaceRoot: '/ws'});
    overlay.activate();
    await hover();
    click({metaKey: true, shiftKey: true});
    await vi.advanceTimersByTimeAsync(0);
    expect(urlOf(fetchMock).searchParams.get('file')).toBe('src/card.ts');
  });

  test('a library element with only a call site opens it on Ctrl+click', async () => {
    const tag = `x-lib-${counter++}`;
    customElements.define(
      tag,
      class extends HTMLElement {
        static elementProperties = new Map();
      }
    );
    const el = document.createElement(tag);
    el.setAttribute('data-lit-source', SITE);
    el.getBoundingClientRect = () =>
      ({
        ...RECT,
        right: RECT.left + RECT.width,
        bottom: RECT.top + RECT.height,
      }) as DOMRect;
    document.body.append(el);
    hitTarget = el;
    const fetchMock = vi.fn(async () => ({ok: true}));
    vi.stubGlobal('fetch', fetchMock);
    const onSelect = vi.fn();
    mount({hosts: 'lit', workspaceRoot: '/ws', onSelect});
    overlay.activate();
    await hover();
    expect(byId('path').style.display).toBe('none');
    expect(byId('site-row').style.display).toBe('');
    click({ctrlKey: true});
    await vi.advanceTimersByTimeAsync(0);
    expect(urlOf(fetchMock).searchParams.get('column')).toBe('5');
    // onSelect still needs a declaration, which a library element lacks.
    expect(onSelect).not.toHaveBeenCalled();
  });

  test('falls back to the editor URL scheme with the column', async () => {
    const {el} = makeTarget();
    el.setAttribute('data-lit-source', SITE);
    hitTarget = el;
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('offline');
      })
    );
    const open = vi.fn();
    vi.stubGlobal('open', open);
    mount({workspaceRoot: '/ws', editor: 'cursor'});
    overlay.activate();
    await hover();
    click({metaKey: true, shiftKey: true});
    await vi.advanceTimersByTimeAsync(0);
    expect(open).toHaveBeenCalledWith(
      'cursor://file/src/page.ts:12:5',
      '_self'
    );
  });

  test('stepping to another host updates the row', async () => {
    const outer = makeTarget();
    const inner = makeTarget();
    outer.el.setAttribute('data-lit-source', SITE);
    outer.el.append(inner.el);
    hitTarget = inner.el;
    mount({workspaceRoot: '/ws'});
    overlay.activate();
    await hover();
    expect(byId('site-row').style.display).toBe('none');
    key({key: 'ArrowUp'});
    expect(byId('site-row').style.display).toBe('');
    key({key: 'ArrowDown'});
    expect(byId('site-row').style.display).toBe('none');
  });
});

describe('modifier hint', () => {
  const SITE = '/ws/src/page.ts:12:5';
  const armed = () =>
    ['source-row', 'site-row'].filter((id) =>
      byId(id).classList.contains('armed')
    );
  const keyup = (init: KeyboardEventInit) =>
    document.body.dispatchEvent(
      new KeyboardEvent('keyup', {bubbles: true, ...init})
    );

  test('lights the row the held modifiers would open', async () => {
    const {el} = makeTarget();
    el.setAttribute('data-lit-source', SITE);
    hitTarget = el;
    mount({workspaceRoot: '/ws'});
    overlay.activate();
    await hover();
    expect(armed()).toEqual([]);
    key({key: 'Meta', metaKey: true});
    expect(armed()).toEqual(['source-row']);
    key({key: 'Shift', metaKey: true, shiftKey: true});
    expect(armed()).toEqual(['site-row']);
    keyup({key: 'Shift', metaKey: true});
    expect(armed()).toEqual(['source-row']);
    keyup({key: 'Meta'});
    expect(armed()).toEqual([]);
  });

  test('follows the click fallback without a call site', async () => {
    const {el} = makeTarget();
    hitTarget = el;
    mount({workspaceRoot: '/ws'});
    overlay.activate();
    await hover();
    key({key: 'Shift', ctrlKey: true, shiftKey: true});
    expect(armed()).toEqual(['source-row']);
  });

  test('clears when the window loses focus', async () => {
    const {el} = makeTarget();
    hitTarget = el;
    mount({workspaceRoot: '/ws'});
    overlay.activate();
    await hover();
    key({key: 'Control', ctrlKey: true});
    expect(armed()).toEqual(['source-row']);
    window.dispatchEvent(new Event('blur'));
    expect(armed()).toEqual([]);
  });

  test('picks up modifiers from pointer moves', async () => {
    const {el} = makeTarget();
    hitTarget = el;
    mount({workspaceRoot: '/ws'});
    overlay.activate();
    document.dispatchEvent(
      new MouseEvent('mousemove', {
        clientX: 40,
        clientY: 40,
        ctrlKey: true,
        bubbles: true,
      })
    );
    await vi.advanceTimersByTimeAsync(100);
    expect(armed()).toEqual(['source-row']);
  });
});

describe('keyboard', () => {
  test('Escape is swallowed while active and does not dismiss the overlay', () => {
    mount();
    overlay.activate();
    const e = key({key: 'Escape'});
    expect(e.defaultPrevented).toBe(true);
    expect(dialog().open).toBe(true);
  });

  test('Escape passes through while inactive', () => {
    mount();
    expect(key({key: 'Escape'}).defaultPrevented).toBe(false);
  });

  test('the dialog cancel event (native Escape) is prevented', () => {
    mount();
    overlay.activate();
    const cancel = new Event('cancel', {cancelable: true});
    dialog().dispatchEvent(cancel);
    expect(cancel.defaultPrevented).toBe(true);
  });

  test('Ctrl+Shift+S toggles, and the key is configurable', () => {
    mount();
    key({key: 'S', ctrlKey: true, shiftKey: true});
    expect(dialog().open).toBe(true);
    key({key: 's', metaKey: true, shiftKey: true});
    expect(dialog().open).toBe(false);
  });

  test('other chords and a configured key are respected', () => {
    mount({key: 'x'});
    key({key: 's', ctrlKey: true, shiftKey: true});
    key({key: 'x', ctrlKey: true});
    expect(dialog().open).toBe(false);
    key({key: 'x', ctrlKey: true, shiftKey: true});
    expect(dialog().open).toBe(true);
  });
});

describe('lit hosts (no source metadata)', () => {
  /** A Lit-shaped element: a ReactiveElement class carries `elementProperties`. */
  const makeLitTarget = () => {
    const tag = `x-lit-${counter++}`;
    class Plain extends HTMLElement {
      static elementProperties = new Map();
    }
    customElements.define(tag, Plain);
    const el = document.createElement(tag);
    el.getBoundingClientRect = () =>
      ({
        ...RECT,
        right: RECT.left + RECT.width,
        bottom: RECT.top + RECT.height,
      }) as DOMRect;
    document.body.append(el);
    return {tag, el};
  };

  test('outlines an unstamped Lit element, naming it without a source', async () => {
    const {tag, el} = makeLitTarget();
    hitTarget = el;
    mount({hosts: 'lit'});
    overlay.activate();
    await hover();
    expect(byId('tag').textContent).toBe(`<${tag}>`);
    expect(byId('path').style.display).toBe('none');
    expect(byId('open').style.display).toBe('none');
  });

  test('ignores a plain custom element', async () => {
    const tag = `x-plain-${counter++}`;
    customElements.define(tag, class extends HTMLElement {});
    const el = document.createElement(tag);
    document.body.append(el);
    hitTarget = el;
    mount({hosts: 'lit'});
    overlay.activate();
    await hover();
    expect(byId('tooltip').style.display).toBe('none');
  });

  test('a click picks into the panel and reports the id, without onSelect', async () => {
    const {el} = makeLitTarget();
    hitTarget = el;
    const onPick = vi.fn<(id: number) => void>();
    const onSelect = vi.fn();
    mount({hosts: 'lit', onPick, onSelect});
    overlay.activate();
    await hover();
    // Ctrl-click would open the source; with none it is a plain pick.
    click({ctrlKey: true});
    expect(onPick).toHaveBeenCalledOnce();
    expect(typeof onPick.mock.calls[0]![0]).toBe('number');
    expect(onSelect).not.toHaveBeenCalled();
    expect(dialog().open).toBe(false);
  });

  test('a stamped component keeps its source', async () => {
    const {el} = makeTarget();
    hitTarget = el;
    mount({hosts: 'lit', workspaceRoot: '/ws'});
    overlay.activate();
    await hover();
    expect(byId('path').textContent).toBe('src/card.ts:7');
    expect(byId('open').style.display).toBe('');
  });

  test('source mode still skips an unstamped Lit element', async () => {
    const {el} = makeLitTarget();
    hitTarget = el;
    mount();
    overlay.activate();
    await hover();
    expect(byId('tooltip').style.display).toBe('none');
  });
});

describe('stepping with the arrow keys', () => {
  /** <x-target>#shadow <lib-card><lib-box>, the inner two unstamped. */
  const makeNested = () => {
    const {el: page} = makeTarget();
    const lib = () => {
      const tag = `x-lib-${counter++}`;
      customElements.define(
        tag,
        class extends HTMLElement {
          static elementProperties = new Map();
        }
      );
      const el = document.createElement(tag);
      el.getBoundingClientRect = () => page.getBoundingClientRect();
      return el;
    };
    const card = lib();
    const box = lib();
    card.append(box);
    page.attachShadow({mode: 'open'}).append(card);
    return {page, card, box};
  };

  test('ArrowUp steps out to the enclosing host, ArrowDown back in', async () => {
    const {page, card, box} = makeNested();
    hitTarget = box;
    mount({hosts: 'lit'});
    overlay.activate();
    await hover();
    expect(byId('tag').textContent).toBe(`<${box.localName}>`);
    expect(byId('step').textContent).toBe(`↑ <${card.localName}>`);

    expect(key({key: 'ArrowUp'}).defaultPrevented).toBe(true);
    expect(byId('tag').textContent).toBe(`<${card.localName}>`);
    expect(byId('step').textContent).toBe(
      `↑ <${page.localName}>  ↓ <${box.localName}>`
    );

    key({key: 'ArrowUp'});
    expect(byId('tag').textContent).toBe(`<${page.localName}>`);
    expect(byId('step').textContent).toBe(`↓ <${card.localName}>`);
    // Nothing further out: stays put.
    key({key: 'ArrowUp'});
    expect(byId('tag').textContent).toBe(`<${page.localName}>`);

    key({key: 'ArrowDown'});
    key({key: 'ArrowDown'});
    expect(byId('tag').textContent).toBe(`<${box.localName}>`);
    expect(byId('step').textContent).toBe(`↑ <${card.localName}>`);
  });

  test('moving over the same host keeps the stepped-out target, and a click picks it', async () => {
    const {page, box} = makeNested();
    hitTarget = box;
    const onPick = vi.fn<(id: number) => void>();
    mount({hosts: 'lit', onPick, workspaceRoot: '/ws'});
    overlay.activate();
    await hover();
    key({key: 'ArrowUp'});
    key({key: 'ArrowUp'});
    await hover(41, 41);
    expect(byId('tag').textContent).toBe(`<${page.localName}>`);
    expect(byId('path').textContent).toBe('src/card.ts:7');
    click();
    expect(onPick).toHaveBeenCalledOnce();
  });

  test('source mode steps over unstamped hosts', async () => {
    const {page} = makeNested();
    const inner = document.createElement(makeTarget().tag);
    inner.getBoundingClientRect = () => page.getBoundingClientRect();
    page.shadowRoot!.firstElementChild!.append(inner);
    hitTarget = inner;
    mount();
    overlay.activate();
    await hover();
    key({key: 'ArrowUp'});
    expect(byId('tag').textContent).toBe(`<${page.localName}>`);
  });

  test('arrow keys pass through while inactive', () => {
    mount();
    expect(key({key: 'ArrowUp'}).defaultPrevented).toBe(false);
  });
});
