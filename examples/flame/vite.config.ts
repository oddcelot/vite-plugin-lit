import {defineConfig} from 'vite';
import {litPlugin} from '@oddsquad/vite-plugin-lit';

// HMR is on by default: edit `src/lit-flame.ts` while the page is open and the
// component is patched in place. The indicator in the corner counts patches.
export default defineConfig({
  plugins: [litPlugin({hmr: {indicator: {count: true}}})],
});
