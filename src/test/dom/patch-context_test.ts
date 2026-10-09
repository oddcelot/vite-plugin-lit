import {expect, test} from 'vite-plus/test';
import {LitElement, html} from 'lit';
import {state} from 'lit/decorators.js';
import {consume, createContext, provide} from '@lit/context';
import {install} from '../../lib/runtime/patch.js';

// A hot patch of a `@provide` host, with real Lit and @lit/context. Each
// evaluation of the host's module makes a new provider for live instances;
// its consumers have to move over to it, or they stop hearing about the
// values the host provides from then on.

interface Cart {
  items: number;
}

const cartContext = createContext<Cart>('patch-context-cart');

// This project doesn't transform decorators, so they are applied by hand, in
// the order `@provide @state() cart` would apply them (bottom up).
const decorate = (
  proto: object,
  key: string,
  ...decorators: Array<(proto: object, key: string) => void>
) => {
  for (const d of decorators.reverse()) d(proto, key);
};

/** One evaluation of the host's module: a fresh class, as HMR makes. */
const hostClass = () => {
  class XCartApp extends LitElement {
    declare cart: Cart;

    constructor() {
      super();
      this.cart = {items: 0};
    }

    render() {
      return html`<slot></slot>`;
    }
  }
  decorate(
    XCartApp.prototype,
    'cart',
    provide({context: cartContext}) as (proto: object, key: string) => void,
    state() as (proto: object, key: string) => void
  );
  return XCartApp;
};

class XCartButton extends LitElement {
  declare cart?: Cart;

  render() {
    return html`Cart: ${this.cart?.items}`;
  }
}
decorate(
  XCartButton.prototype,
  'cart',
  consume({context: cartContext, subscribe: true}) as (
    proto: object,
    key: string
  ) => void,
  state() as (proto: object, key: string) => void
);

const settle = () => new Promise<void>((r) => setTimeout(r));

test('consumers follow a @provide host across a hot patch', async () => {
  install();
  customElements.define('x-cart-app', hostClass());
  customElements.define('x-cart-button', XCartButton);

  const app = document.createElement('x-cart-app') as LitElement & {
    cart: Cart;
  };
  const button = document.createElement('x-cart-button') as XCartButton;
  app.append(button);
  document.body.append(app);
  await settle();

  app.cart = {items: 1};
  await settle();
  expect(button.cart).toEqual({items: 1});

  // The edited module runs again and defines the tag a second time.
  customElements.define('x-cart-app', hostClass());
  await settle();
  // The value carried across the patch reaches the consumer...
  expect(button.cart).toEqual({items: 1});

  // ...and so does every value the host provides after it.
  app.cart = {items: 2};
  await settle();
  expect(button.cart).toEqual({items: 2});
  expect(button.renderRoot.textContent).toContain('Cart: 2');

  app.remove();
});
