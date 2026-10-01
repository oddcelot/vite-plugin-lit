import {defineConfig} from 'vite';
import {litPlugin} from '@oddsquad/vite-plugin-lit';

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
  plugins: [
    litPlugin({
      // HMR is on by default: edit `src/packing-list.ts` while the page is open
      // and the component is patched in place. The corner counts patches.
      hmr: {indicator: {count: true}},
      // The Lit panel in the dock.
      timeline: true,
      // Pick an element on the page (Ctrl/⌘+Shift+S, or Pick in the panel).
      // `hosts: 'lit'` lets it pick the <wa-*> elements as well as your own
      // components; ↑ and ↓ step out to the element around the outlined one.
      sourceOverlay: {hosts: 'lit'},
    }),
  ],
});
