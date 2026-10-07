/**
 * Builds the Firefox flavour of the extension into `dist/extension-firefox/`:
 *
 *     pnpm run build:extension:firefox
 *
 * The same three passes as `build:extension`, with `LIT_EXTENSION_BROWSER`
 * set so `extension/vite.config.ts` writes the Firefox manifest and the
 * toolbar popup. Set from here rather than in the package script, which
 * would need a POSIX shell.
 */

import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const env = {...process.env, LIT_EXTENSION_BROWSER: 'firefox'};

for (const mode of [[], ['--mode', 'page'], ['--mode', 'content']]) {
  execFileSync('vp', ['build', 'extension', ...mode], {
    cwd: ROOT,
    env,
    stdio: 'inherit',
  });
}
