import {afterEach, describe, expect, test} from 'vite-plus/test';
import {collectAnatomy} from '../../lib/runtime/inspector/anatomy.js';

let counter = 0;

/**
 * Defines a ReactiveElement look-alike whose shadow root holds `template`.
 * `renderRoot` mirrors Lit's, so a closed root is still reachable.
 */
const define = (
  template: string | null,
  init: ShadowRootInit = {mode: 'open'}
): string => {
  const tag = `x-anatomy-${counter++}`;
  class El extends HTMLElement {
    renderRoot: Element | ShadowRoot;
    requestUpdate() {}
    constructor() {
      super();
      if (template === null) {
        this.renderRoot = this;
      } else {
        this.renderRoot = this.attachShadow(init);
        this.renderRoot.innerHTML = template;
      }
    }
  }
  customElements.define(tag, El);
  return tag;
};

const mount = (tag: string, light = ''): HTMLElement => {
  const el = document.createElement(tag);
  el.innerHTML = light;
  document.body.append(el);
  return el;
};

afterEach(() => {
  document.body.innerHTML = '';
});

describe('collectAnatomy', () => {
  test('reports a light-DOM render root with no slots', () => {
    const el = mount(define(null), '<p>hi</p>');
    expect(collectAnatomy(el)).toEqual({
      renderRoot: 'light',
      slots: [],
      orphans: [],
      orphanText: 0,
      parts: [],
    });
  });

  test('is undefined for an element with no render root', () => {
    expect(collectAnatomy(document.createElement('div'))).toBeUndefined();
  });

  test('lists default and named slots with what is assigned', () => {
    const el = mount(
      define('<slot name="header"></slot><slot></slot>'),
      '<h1 slot="header">Title</h1><p>one</p>text<p>two</p>'
    );
    const a = collectAnatomy(el)!;
    expect(a.renderRoot).toBe('shadow');
    expect(a.mode).toBe('open');
    expect(a.slots).toEqual([
      expect.objectContaining({
        name: 'header',
        status: 'assigned',
        elements: [{tagName: 'h1'}],
        textNodes: 0,
      }),
      expect.objectContaining({
        name: '',
        status: 'assigned',
        elements: [{tagName: 'p'}, {tagName: 'p'}],
        textNodes: 1,
      }),
    ]);
    expect(a.orphans).toEqual([]);
  });

  test('tells fallback content from an empty slot', () => {
    const el = mount(
      define('<slot name="icon">★</slot><slot name="footer"></slot>')
    );
    const [icon, footer] = collectAnatomy(el)!.slots;
    expect(icon.status).toBe('fallback');
    expect(footer.status).toBe('empty');
  });

  test('flags children no slot takes, and a duplicate slot name', () => {
    const el = mount(
      define('<slot name="a"></slot><slot name="a"></slot>'),
      '<span slot="a"></span><b slot="missing"></b><i></i>loose'
    );
    const a = collectAnatomy(el)!;
    expect(a.slots.map((s) => s.duplicate)).toEqual([false, true]);
    expect(a.orphans).toEqual([
      {tagName: 'b', slot: 'missing'},
      {tagName: 'i', slot: ''},
    ]);
    expect(a.orphanText).toBe(1);
  });

  test('marks content forwarded from an enclosing slot', () => {
    const inner = define('<slot></slot>');
    const outer = mount(
      define(`<${inner}><slot></slot></${inner}>`),
      '<p></p>'
    );
    const innerEl = outer.shadowRoot!.querySelector(inner)!;
    const [slot] = collectAnatomy(innerEl)!.slots;
    expect(slot.forwarded).toBe(true);
    expect(slot.elements).toEqual([{tagName: 'p'}]);
  });

  test('reads a closed shadow root through renderRoot', () => {
    const el = mount(
      define('<slot></slot><div part="body label"></div>', {mode: 'closed'}),
      '<p></p>'
    );
    const a = collectAnatomy(el)!;
    expect(a.mode).toBe('closed');
    expect(a.slots[0].elements).toEqual([{tagName: 'p'}]);
    expect(a.orphans).toEqual([]);
    expect(a.parts).toEqual([{names: ['body', 'label'], tagName: 'div'}]);
  });

  test('gives inspectable assigned elements an id', () => {
    const child = define(null);
    const el = mount(define('<slot></slot>'), `<${child}></${child}>`);
    const [ref] = collectAnatomy(el)!.slots[0].elements;
    expect(ref.tagName).toBe(child);
    expect(typeof ref.id).toBe('number');
  });
});
