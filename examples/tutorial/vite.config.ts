import {defineConfig} from 'vite';
import {litPlugin} from '@oddsquad/vite-plugin-lit';

export default defineConfig({
  plugins: [litPlugin({hmr: {indicator: {count: true}}})],
});
