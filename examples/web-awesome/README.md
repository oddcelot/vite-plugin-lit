# Lit + Web Awesome

A Lit component built from [Web Awesome](https://webawesome.com) elements,
edited while it runs. The plugin patches your component and leaves the
library's elements alone, so what they hold survives the edit too.

[![Open in StackBlitz](https://developer.stackblitz.com/img/open_in_stackblitz_small.svg)](https://stackblitz.com/github/oddcelot/vite-plugin-lit/tree/main/examples/web-awesome?file=src/packing-list.ts)

`<packing-list>` is a card with a progress bar, an input, a checklist and a
switch, all `<wa-*>` elements:

- **The list** is reactive state (`@state() items`). Add an item, tick a few.
- **Hide packed items** is `@state() hidePacked`, set from `<wa-switch>`.
- **The input's text** is not the component's state at all: it lives inside
  `<wa-input>`.
- **New ids** come from a native `#private` field, which Lit does not track.

The progress bar's colour is a custom property in the component's `styles`,
pointing at a Web Awesome design token.

## Try it

Run it (on StackBlitz this has already happened):

```sh
npm install
npm run dev
```

Add an item, tick a couple, flip the switch and type something into the input
without pressing Add. Then, with the page still open, edit
`src/packing-list.ts` and save after each change:

1. **The template.** Change `<h2>Packing list</h2>` to another title, or
   `'neutral'` to `'warning'` on the badge. The card updates; your list, the
   switch and the half-typed text are as you left them.
2. **A colour.** Change `--packed-color` from
   `var(--wa-color-brand-fill-loud)` to `var(--wa-color-success-fill-loud)`.
   The progress bar turns green.
3. **A method.** In `#add()`, change `{id: this.#nextId++, label, …}` to
   `{id: this.#nextId++, label: label.toUpperCase(), …}` and add an item. It arrives in capitals; the items
   already there keep their spelling, and `#nextId` carries on from where it
   was.

None of these reloads the page. The counter in the corner shows how many
updates were applied in place.

Only your own files are patched. Web Awesome comes from `node_modules`, which
the plugin skips; its elements are never redefined, they are re-rendered by
your component like any other child.

## Look inside with DevTools

The button in the bottom-left corner opens the Vite DevTools dock, with the
plugin's Lit panel in it:

- **Components** lists `<packing-list>` with its state and the line it is
  defined on. Web Awesome is built on Lit, so the `<wa-*>` elements inside it
  are listed too, with their properties, but without a source line: they are
  not your code.
- **Timeline** records each update once you press **Record**: tick an item and
  watch `<packing-list>` update, then the checkbox, badge and progress bar it
  re-renders.
- **Updates** sums them up per component and says which property changed.

## In this repository

The example is a workspace package and links the plugin built from this
checkout:

```sh
pnpm install      # from the repository root
pnpm build        # builds the plugin the example links
cd examples/web-awesome
pnpm dev
```

On StackBlitz it installs the published plugin and plain Vite with npm, and
starts with `npm run stackblitz`: `stackblitz.mjs` is the flame example's,
which explains why.
