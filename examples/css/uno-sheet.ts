import fs from 'node:fs';
import path from 'node:path';
import {createGenerator, type UserConfig} from 'unocss';
import type {Plugin, ViteDevServer} from 'vite';

/**
 * Options for {@link unoSheet}.
 */
interface UnoSheetOptions {
  /** The UnoCSS config: presets, theme, content pipeline. */
  config: UserConfig;
  /** Absolute path of the `.css` file to write, imported with `?css-sheet`. */
  outFile: string;
  /** Directory, relative to the project root, scanned for utility classes. */
  dir: string;
  /** Files that count as source. Defaults to `.ts`, `.js` and `.html`. */
  include?: RegExp;
}

/**
 * Writes the utility classes your source uses into a real `.css` file, so
 * every component can adopt them as one shared sheet.
 *
 * UnoCSS's own Vite plugin serves its CSS from `virtual:uno.css`, a module
 * with no URL. `?css-sheet` works by fetching the file's URL and adopting the
 * result, so it has nothing to fetch from a virtual module. This plugin
 * generates the CSS itself and writes it to `outFile`. The file is then an
 * ordinary stylesheet: `?css-sheet` gives every importer the same
 * `CSSStyleSheet`, `vite build` emits it as a content-hashed asset, and when
 * a new class lands in a component the file changes and the plugin swaps the
 * rules inside the sheet that is already adopted.
 *
 * Utilities are collected twice. `buildStart` scans `dir`, so the first
 * dev load and `vite build` start with every class. In dev, `transform` then
 * feeds each edited module through the same extractors and rewrites the file
 * when a new class shows up. A build never regenerates after `buildStart`.
 *
 * Preflights are off: the sheet carries utilities only. A preflight is a
 * global reset, and it would be repeated inside every shadow root.
 */
export function unoSheet(options: UnoSheetOptions): Plugin {
  const include = options.include ?? /\.(ts|js|html)$/;
  const tokens = new Set<string>();
  let uno: Awaited<ReturnType<typeof createGenerator>>;
  let root = process.cwd();
  let written = '';
  let server: ViteDevServer | undefined;

  /** Generates the CSS for every token seen so far and writes it if it changed. */
  const write = async () => {
    const {css} = await uno.generate(tokens, {preflights: false});
    // Writing identical bytes would still make Vite's watcher fire.
    if (css === written) {
      return;
    }
    written = css;
    fs.mkdirSync(path.dirname(options.outFile), {recursive: true});
    fs.writeFileSync(options.outFile, css);
  };

  return {
    name: 'uno-sheet',
    // Before the plugin that turns TypeScript into JavaScript, so the
    // extractors read the source the way you wrote it.
    enforce: 'pre',
    configResolved(config) {
      root = config.root;
    },
    configureServer(devServer) {
      server = devServer;
    },
    async buildStart() {
      uno ??= await createGenerator(options.config);
      const dir = path.resolve(root, options.dir);
      // `fs.promises.glob` would do this in one call, but StackBlitz's Node
      // does not have it; a recursive `readdirSync` runs everywhere.
      for (const entry of fs.readdirSync(dir, {recursive: true})) {
        const file = path.join(dir, String(entry));
        if (include.test(file) && file !== options.outFile) {
          await uno.applyExtractors(
            fs.readFileSync(file, 'utf8'),
            file,
            tokens
          );
        }
      }
      await write();
    },
    async transform(code, id) {
      const file = id.split('?')[0];
      if (
        !server ||
        !include.test(file) ||
        file === options.outFile ||
        file.includes('/node_modules/')
      ) {
        return;
      }
      const before = tokens.size;
      await uno.applyExtractors(code, file, tokens);
      if (tokens.size !== before) {
        // The write changes `outFile`; Vite's watcher sees that, and the
        // lit plugin turns it into a swap of the adopted sheet.
        await write();
      }
    },
  };
}
