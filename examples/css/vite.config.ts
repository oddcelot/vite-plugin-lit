import path from 'node:path';
import {defineConfig} from 'vite';
import {presetWind3} from 'unocss';
import {litPlugin} from '@oddsquad/vite-plugin-lit';
import {unoSheet} from './uno-sheet.ts';

export default defineConfig({
  // The Vite DevTools dock, where the plugin adds its Lit panel: the
  // component tree, the timeline and what made each component update.
  //
  // `clientAuth: false` skips the per-browser approval DevTools asks for in
  // the terminal, which nobody can answer on StackBlitz. Fine for a throwaway
  // demo; don't copy it into a server reachable from other machines.
  //
  // `dockPreferences` starts the dock as a toolbar along the bottom edge.
  // Only a default: a browser that has moved the dock keeps its own layout.
  devtools: {
    enabled: true,
    apply: 'serve',
    clientAuth: false,
    dockPreferences: {defaultMode: 'edge', defaultPosition: 'bottom'},
  },
  css: {
    // Lightning CSS runs over every stylesheet the build pipeline sees: the
    // `.css` files, the `?css-sheet` and `?hmr-url` imports, and the `css`
    // literals in components. The targets are old on purpose, so the
    // downlevelling is visible: nesting is flattened and `oklch()` and
    // `light-dark()` get fallbacks. Drop `targets` to leave modern CSS alone.
    // (`?raw` skips the pipeline, so it stays as you wrote it.)
    transformer: 'lightningcss',
    lightningcss: {
      // major << 16 | minor << 8 (Lightning CSS version encoding).
      targets: {chrome: 100 << 16, safari: 15 << 16},
    },
  },
  build: {
    // The production build ships sourcemaps, so the Lit Inspector browser
    // extension can show where each component is defined on the built site.
    sourcemap: true,
    // Minifying would fold the fallbacks Lightning CSS just wrote into one
    // line. Leave the output readable; turn it back on for a real site.
    cssMinify: false,
  },
  plugins: [
    // Writes `src/uno.generated.css` from the classes in `src/`. It runs
    // before the lit plugin and has to: `css-utility-card.ts` imports the
    // file with `?css-sheet`. See `uno-sheet.ts` for why it exists.
    unoSheet({
      outFile: path.resolve(import.meta.dirname, 'src/uno.generated.css'),
      dir: 'src',
      config: {
        // Wind3 is UnoCSS's Tailwind-compatible preset. `preflight: false`
        // drops its global reset, which a shadow root would not see anyway.
        presets: [presetWind3({preflight: false})],
        theme: {
          // `bg-brand`, `text-brand`, `border-brand`: the utilities read the
          // `--brand` token from `src/tokens.css`, so editing the token
          // recolours them too. (Opacity modifiers like `bg-brand/20` need a
          // colour UnoCSS can parse, which a `var()` is not.)
          colors: {brand: 'var(--brand)'},
        },
        // Collect classes from `.ts` and `.html` only. UnoCSS's default
        // pipeline also reads framework files this project does not have.
        content: {pipeline: {include: [/\.(ts|html)($|\?)/]}},
      },
    }),
    litPlugin({
      // HMR is on by default: edit a card and it is patched in place. The
      // corner counts patches.
      hmr: {indicator: {count: true}},
      // The Lit panel in the dock. Its Timeline records clicks, keystrokes
      // and what each one caused.
      timeline: true,
      // Pick an element on the page (Ctrl/⌘+Shift+S, or Pick in the panel)
      // and jump to the component that rendered it.
      sourceOverlay: true,
    }),
  ],
});
