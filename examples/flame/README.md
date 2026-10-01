# Lit flame

The smallest app that shows what `@oddsquad/vite-plugin-lit` is for: one Lit
component, edited while it runs, keeping everything you did to it.

[![Open in StackBlitz](https://developer.stackblitz.com/img/open_in_stackblitz_small.svg)](https://stackblitz.com/github/oddcelot/vite-plugin-lit/tree/main/examples/flame?file=src/lit-flame.ts)

`<lit-flame>` draws the Lit logo and gives you three things to change:

- **Hue** turns the flame's colours. It is reactive state (`@state() hue`).
- **Blow out / Light** stops or starts the flicker, also `@state`.
- **Stoke** makes the flame bigger. The count lives in a native `#private`
  field, which Lit does not track, so the method requests the update itself.

The colours are four `oklch()` custom properties in the component's `styles`.

## Try it

Run it (on StackBlitz this has already happened):

```sh
npm install
npm run dev
```

Move the hue slider, stoke the flame a few times and blow it out. Then, with
the page still open, edit `src/lit-flame.ts` and save after each change:

1. **A colour.** Change `--facet-glow` from `oklch(0.85 0.15 …)` to
   `oklch(0.7 0.25 …)`. The flame recolours. The hue, the stoke count and the
   blown-out flame are as you left them.
2. **The template.** Rename the `Stoke` button. The label changes and nothing
   else does.
3. **A method that uses the private field.** In `#stoke()`, change
   `this.#stokes++` to `this.#stokes += 2` and press Stoke. The count carries on
   from where it was, two at a time.

None of these reloads the page. The counter in the corner shows how many
updates were applied in place. Without the plugin, each save would be a full
reload and you would start again from a lit, unstoked, blue flame.

## In this repository

The example is a workspace package and links the plugin built from this
checkout:

```sh
pnpm install      # from the repository root
pnpm build        # builds the plugin the example links
cd examples/flame
pnpm dev
```

On StackBlitz it installs the published plugin and plain Vite with npm, and
starts with `npm run stackblitz`: the `vite` command does not start in a
WebContainer, so `stackblitz.mjs` starts the same server through Vite's
JavaScript API, as the playground does.

Private-field updates need Vite 8: on Vite 7 the TypeScript step rewrites
`#private` before the plugin can, and the third edit above fails.
