import {createContext} from '@lit/context';

export interface CartItem {
  id: string;
  name: string;
  price: number;
}

export interface Cart {
  items: CartItem[];
}

/**
 * The cart, provided by `<fh-app>` and consumed by `<fh-cart-button>`. The
 * panel's Components tab draws the link between the two.
 */
export const cartContext = createContext<Cart>('fh-cart');
