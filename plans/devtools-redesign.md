# DevTools design tokens

The panel and the injected runtime elements (indicator, source overlay) share
one design-token layer that follows the Lit design system: an accent of flame
blue, the Lit flame in the panel header, and both a dark and a light theme.

## Decisions

- **Two delivery paths for one token set.** Panel components are Lit elements in
  shadow roots, so they consume `tokens` as a `css` export. The runtime elements
  live in the inspected app's page, so they call `injectTokens()`, which adds a
  `:root { ... }` block to the page head. Custom properties cascade into shadow
  DOM, so the runtime components just use `var(--*)`. Both are in
  `src/lib/tokens.ts`.
- **System font stacks, not the design system's web fonts.** `--font-sans` is
  `system-ui` and `--font-mono` is `ui-monospace`. Loading Manrope and Roboto
  Mono would cost network in the Vite side-panel iframe for a dev-only tool.
- **Both themes ship in the token layer.** The theme follows
  `prefers-color-scheme` by default and can be forced per host with
  `.theme-light` or `.theme-dark`. The Settings tab's Appearance selector (Auto,
  Dark, Light) drives `color-scheme` on the panel root.
- **No hardcoded colors in components.** Any new panel or runtime style uses the
  tokens, so a theme change stays a one-file edit.
- **Design-system modules live in `src/lib/`.** `tokens.ts`,
  `segmented-tabs.ts`, `icons.ts` and `color-scheme.ts` import only `lit`, and
  both browser surfaces need them. Moving them next to the panel would touch
  every import for no gain.

## Source

`src/lib/tokens.ts`, `src/lib/segmented-tabs.ts`, `src/lib/color-scheme.ts`,
`src/lib/icons.ts`.
