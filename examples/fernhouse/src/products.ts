export type PlantKind =
  | 'monstera'
  | 'fiddle'
  | 'snake'
  | 'pothos'
  | 'zz'
  | 'calathea';

export interface Product {
  id: string;
  name: string;
  price: number;
  /** The line under the title. */
  note: string;
  badge?: string;
  /** Shown struck through next to the price, through the card's price slot. */
  was?: number;
  /** Which plant the picture draws. */
  art: PlantKind;
}

export const products: Product[] = [
  {
    id: 'monstera',
    name: 'Monstera',
    price: 34,
    note: 'Bright, indirect light · 40 cm',
    badge: 'Bestseller',
    art: 'monstera',
  },
  {
    id: 'fiddle',
    name: 'Fiddle Leaf Fig',
    price: 48,
    note: 'Likes a sunny corner · 70 cm',
    art: 'fiddle',
  },
  {
    id: 'snake',
    name: 'Snake Plant',
    price: 22,
    note: 'Beginner friendly · 55 cm',
    badge: 'Low light',
    art: 'snake',
  },
  {
    id: 'pothos',
    name: 'Golden Pothos',
    price: 18,
    was: 22,
    note: 'Trails from a shelf · 30 cm',
    badge: 'Sale',
    art: 'pothos',
  },
  {
    id: 'zz',
    name: 'ZZ Plant',
    price: 26,
    note: 'Forgives a missed week · 45 cm',
    badge: 'Low light',
    art: 'zz',
  },
  {
    id: 'calathea',
    name: 'Calathea Orbifolia',
    price: 39,
    note: 'Humid and shady · 50 cm',
    art: 'calathea',
  },
];

export interface ReviewsPage {
  rating: number;
  count: number;
  quote: string;
  author: string;
}

const quotes: Record<string, Array<Pick<ReviewsPage, 'quote' | 'author'>>> = {
  fiddle: [
    {quote: 'Arrived upright and unbruised.', author: 'Marta'},
    {quote: 'Dropped one leaf, then settled in.', author: 'Jonas'},
    {quote: 'Taller than the photo suggests.', author: 'Priya'},
  ],
};

/**
 * A stand-in for `fetch('/api/reviews?…')`: it answers from local data after
 * a short delay, so the shop runs offline and the task has a pending phase
 * to show in the panel.
 */
export function fetchReviews(
  productId: string,
  page: number,
  signal?: AbortSignal
): Promise<ReviewsPage> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      const list = quotes[productId] ?? quotes.fiddle;
      resolve({rating: 4.8, count: 126, ...list[page % list.length]});
    }, 300);
    signal?.addEventListener('abort', () => {
      clearTimeout(timer);
      reject(signal.reason);
    });
  });
}
