# Fernhouse

A small plant shop built from Lit components, made to be looked into: a cart
shared through `@lit/context`, slots and parts, a task that loads reviews. It
is the example for the DevTools panel and the Lit Inspector extension, and
the plugin's HMR works on it like on any other.

[![Open in StackBlitz](https://developer.stackblitz.com/img/open_in_stackblitz_small.svg)](https://stackblitz.com/github/oddcelot/vite-plugin-lit/tree/main/examples/fernhouse?file=src/fh-product-card.ts)

Each component is one small file in `src/`:

- **`<fh-app>`** is the shell. It provides the cart with `@lit/context`,
  renders the header and the grid, and listens for the cards' `add-to-cart`
  event.
- **`<fh-header>`** holds the logo, the links, `<fh-search>` and
  `<fh-cart-button>`.
- **`<fh-search>`** keeps the typed text in `@state() query` and fires
  `search-changed`; the grid filters on it.
- **`<fh-cart-button>`** consumes the cart context and shows `Cart · N`.
- **`<fh-product-card>`** has `name`, `price` and `inCart`, the slots `media`,
  default and `price` (with fallback content), and the parts `title` and
  `cta`, which `<fh-app>` styles from the outside with `::part()`.
- **`<fh-reviews>`** sits in the Fiddle Leaf Fig card and loads its rating
  with an `@lit/task` through a fake, delayed fetch. No network involved.
- **`<fh-toast>`** says what was added.

## Try it

Run it (on StackBlitz this has already happened):

```sh
npm install
npm run dev
```

Add a plant to the cart, press **More reviews** on the Fiddle Leaf Fig, and
type "fig" into the search. Then, with the page still open, edit and save:

1. **A style.** In `src/fh-product-card.ts`, change the `button.cta`
   `border-radius` from `6px` to `18px`. Every card's button rounds off; the
   cart, the reviews and the search text are as you left them.
2. **The template.** In the same file, change `Add to cart` to another label.
   The cards update and the ones already in the cart stay marked.
3. **A method.** In `src/fh-toast.ts`, change `2200` in `show()` to `5000`.
   The next plant you add keeps its message up longer; the cart count is
   unchanged.

None of these reloads the page. The counter in the corner shows how many
updates were applied in place.

## Look inside with DevTools

The buttons in the bottom-left corner open the Vite DevTools dock. The Lit
panel is behind the flame icon:

- **Components** shows the tree from `<fh-app>` down; expand it to see the
  header, the cards and the reviews. Press **⌖ Pick**, or Ctrl/⌘+Shift+S on
  the page, and click a card's text to select it (clicking the plant picture
  selects `<fh-app>`, which renders the picture into the card's `media`
  slot). Its properties and state are listed (`name`, `price`, `inCart` and
  the rest) with the line it is defined on. **Anatomy** draws the card's
  slots and parts and what fills each. The price slot shows its fallback,
  except on the Golden Pothos, which fills it with a sale price.
  `<fh-cart-button>` shows the cart context it consumes, with a link to
  `<fh-app>`, which provides it.
- **Timeline** records once you press **Record**. Turn on the **Mouse**,
  **Keyboard** and **Custom events** layers first; they start off. Then click
  **Add to cart** on the Fiddle Leaf Fig: in the list, a cause rail links the
  click to the card's update, and another links the `add-to-cart` event to
  the updates of the cart button, the app and the toast. Press **More
  reviews** to see the task run between a click and the update it ends in,
  and type in the search field to see the keys and `search-changed`.
- **Updates** sums them up per component and says which property changed.

## In a production build

`vite.config.ts` turns on `build.sourcemap`, so the built site carries the
maps the Lit Inspector browser extension reads:

```sh
npm run build
npm run preview
```

Open the preview with the extension installed, open DevTools and enable it
for the site from the **Lit** tab. Its panel lists the same components, with
their slots, parts, context and timeline, and the sourcemaps tell it where
each is defined: `src/fh-product-card.ts:4` for a card. A production build of
Lit sends no render events, so those layers stay empty. The dock above is dev-only; the
extension is how you look at a build.

## In this repository

The example is a workspace package and links the plugin built from this
checkout:

```sh
pnpm install      # from the repository root
pnpm build        # builds the plugin the example links
cd examples/fernhouse
pnpm dev
```

On StackBlitz it installs the published plugin and plain Vite with npm, and
starts with `npm run stackblitz`: `stackblitz.mjs` is the playground's, which
explains why.
