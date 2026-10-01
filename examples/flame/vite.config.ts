import {defineConfig} from 'vite';
import {litPlugin} from '@oddsquad/vite-plugin-lit';

export default defineConfig({
  // The Vite DevTools dock, where the plugin adds its Lit panel: the
  // component tree, the timeline and what made each component update.
  //
  // `clientAuth: false` skips the per-browser approval DevTools asks for in
  // the terminal, which nobody can answer on StackBlitz. Fine for a throwaway
  // demo; don't copy it into a server reachable from other machines.
  devtools: {enabled: true, apply: 'serve', clientAuth: false},
  plugins: [
    litPlugin({
      // HMR is on by default: edit `src/lit-flame.ts` while the page is open
      // and the component is patched in place. The corner counts patches.
      hmr: {indicator: {count: true}},
      // The Lit panel in the dock.
      timeline: true,
      // Pick an element on the page (Ctrl/⌘+Shift+S, or Pick in the panel).
      sourceOverlay: true,
    }),
  ],
});
