# CSS tour

A page that walks through the CSS features of `@oddsquad/vite-plugin-lit`, one
card per way of delivering CSS: real UnoCSS utilities as one shared adopted
sheet, design tokens, a linked file, an inlined file and a `css` literal. Every
card counts its renders, so an edit shows whether it restyled in place or
re-rendered.

[![Open in StackBlitz](https://developer.stackblitz.com/img/open_in_stackblitz_small.svg)](https://stackblitz.com/github/oddcelot/vite-plugin-lit/tree/main/examples/css?file=src/tokens.css)

Each file in `src/` is small:

- **`<css-tour>`** is the page. Its layout is UnoCSS utilities.
- **`<css-utility-card>`** styles a button with UnoCSS utilities from one
  shared sheet (`?css-sheet`).
- **`<css-linked-card>`** keeps its rules in `css-linked-card.css` and loads
  them with a `<link>` (`?hmr-url`).
- **`<css-inline-card>`** inlines `css-inline-card.css` into the JS chunk
  (`?inline` and `unsafeCSS`).
- **`<css-literal-card>`** has a `css` literal in `static styles` that uses
  nesting, `oklch()` and `light-dark()`.
- **`tokens.css`** holds the design tokens (`--brand`, `--space`)
  on `:host`. Every component, the page included, imports it with `?css-sheet`.
- **`card.css`** is the chrome the cards share (box, heading, badge), a second
  `?css-sheet` stacked after the tokens. The page leaves it out.

Each card has a `renders: N` badge. It counts `updated()` calls, so it goes up
when the card re-renders and stays put when only its styles change.

## Try it

Run it (on StackBlitz this has already happened):

```sh
npm install
npm run dev
```

Then, with the page open, edit and save:

1. **A token.** In `src/tokens.css`, change `--brand` to
   `oklch(0.6 0.22 150)`. Every card recolours, the button included, and no
   badge moves. One sheet changed, and it is adopted by all of them.
2. **A utility class.** In `src/css-utility-card.ts`, add `uppercase` to the
   button's `class`. The button's label goes upper case. The sheet is
   regenerated and swapped in place for everything that adopts it, but this
   card's badge goes up because its own template changed. The other badges
   stay.
3. **A linked file.** In `src/css-linked-card.css`, change `padding` to
   `40px`. The linked card re-renders with a fresh `href` and the browser
   refetches the file. Its badge goes up; the others do not.
4. **An inlined file.** In `src/css-inline-card.css`, change `2px dashed` to
   `6px dotted`. The inline card re-renders and its badge goes up. Only it
   does.
5. **A literal.** In `src/css-literal-card.ts`, change the `oklch(0.55 0.22 25)`
   on `em`. Only the literal card re-renders. To see what the plugin did
   to the literal, run `npm run build` and look for `.sample` in
   `dist/assets/index-*.js`: the nesting is flattened and each colour has a
   fallback.

None of these reloads the page. The counter in the corner shows how many
updates were applied in place.

## What each card does

| Card                 | Import                    | What an edit does                             |
| -------------------- | ------------------------- | --------------------------------------------- |
| tokens, UnoCSS sheet | `?css-sheet`              | restyles every adopter in place, no re-render |
| `<css-linked-card>`  | `?hmr-url` and a `<link>` | re-renders that component                     |
| `<css-inline-card>`  | `?inline` and `unsafeCSS` | re-renders that component                     |
| `<css-literal-card>` | a `css` literal           | re-renders that component                     |

This is the table in [Choose how to deliver
CSS](https://oddcelot.github.io/vite-plugin-lit/guides/stylesheets/), played
out. The pages behind it:
[`?css-sheet`](https://oddcelot.github.io/vite-plugin-lit/guides/stylesheets/css-sheet/),
[component styles](https://oddcelot.github.io/vite-plugin-lit/guides/stylesheets/component-styles/)
and [why one shared sheet](https://oddcelot.github.io/vite-plugin-lit/concepts/css-delivery/).
`?raw` is `?inline` without the CSS pipeline: Lightning CSS and PostCSS do not
touch it.

## How UnoCSS gets into shadow roots

Styles do not cross a shadow boundary, so a utility layer has to be inside
every shadow root that uses it. UnoCSS's own `shadow-dom` mode does that by
putting a copy of the CSS in each component's `<style>`. With many components
that is many copies of the same bytes and many `CSSStyleSheet` objects.

This example shares one instead. UnoCSS's Vite plugin serves its CSS from
`virtual:uno.css`, which has no URL, and `?css-sheet` works by fetching a
file's URL, so the two cannot meet. `uno-sheet.ts` is a small plugin that
closes the gap. It reads the utility classes out of `src/` and writes them to
`src/uno.generated.css`, a real file that is gitignored. The lit plugin does
the rest: components that import it with `?css-sheet` adopt the same sheet,
and when a new class makes the file change, the plugin swaps the rules inside
that sheet without re-rendering the adopters.

Two things to know:

- **Preflights are off.** The sheet has utilities only, not Wind3's global
  reset. A few utilities lean on variables the reset defines, so `rotate-*`
  and `shadow-*` render nothing here.
- **UnoCSS reads comments too.** Any word in a `.ts` file that is a utility
  name, in a comment included, ends up in the sheet. It is harmless: a rule
  matters only on an element that has the class.

`bg-brand` and `text-brand` come from the `brand` colour in `vite.config.ts`,
which is `var(--brand)`, so the utilities follow `tokens.css`.

## In a production build

```sh
npm run build
npm run preview
```

`dist/assets/` has the shared sheets as content-hashed files
(`uno.generated-<hash>.css`, `tokens-<hash>.css`, `card-<hash>.css`), the linked card's CSS the
same way, and the inlined and literal CSS inside the JS chunk. The `css`
options in `vite.config.ts` run everything through Lightning CSS with old
browser targets, so the output shows what it does: nesting flattened, `oklch()`
and `light-dark()` with fallbacks. `build.cssMinify` is off so the files stay
readable. The same build has sourcemaps, which the Lit Inspector browser
extension reads.

## In this repository

The example is a workspace package and links the plugin built from this
checkout:

```sh
pnpm install      # from the repository root
pnpm build        # builds the plugin the example links
cd examples/css
pnpm dev
```

On StackBlitz it installs the published plugin and plain Vite with npm, and
starts with `npm run stackblitz`: `stackblitz.mjs` is the playground's, which
explains why.
