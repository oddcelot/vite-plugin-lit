import {createHash} from 'node:crypto';
import {resolve as resolvePath} from 'node:path';
import {type Plugin, searchForWorkspaceRoot} from 'vite';
import type {OptionsContext} from './context.js';

/** Where Chrome DevTools looks for a workspace folder to connect. */
export const DEVTOOLS_JSON_PATH =
  '/.well-known/appspecific/com.chrome.devtools.json';

const isLoopback = (address = ''): boolean =>
  address === '::1' ||
  address.startsWith('127.') ||
  address.startsWith('::ffff:127.');

/**
 * A v4-shaped UUID hashed from `root`, so DevTools recognises the same
 * workspace across server restarts instead of offering a new one each time.
 */
export const workspaceUuid = (root: string): string => {
  const hash = createHash('sha256').update(root).digest('hex');
  const variant = ((Number.parseInt(hash[16], 16) & 0x3) | 0x8).toString(16);
  return [
    hash.slice(0, 8),
    hash.slice(8, 12),
    `4${hash.slice(13, 16)}`,
    `${variant}${hash.slice(17, 20)}`,
    hash.slice(20, 32),
  ].join('-');
};

/**
 * Answers `root` and its UUID on {@link DEVTOOLS_JSON_PATH}. The reply names
 * an absolute path on this machine, so only loopback clients get it; a dev
 * server exposed with `--host` passes everyone else on.
 */
export const createDevtoolsJsonMiddleware = (root: string) => {
  const body = JSON.stringify({workspace: {root, uuid: workspaceUuid(root)}});
  return (
    req: {url?: string; socket?: {remoteAddress?: string}},
    res: {
      setHeader(name: string, value: string): void;
      end(body: string): void;
    },
    next: () => void
  ) => {
    if (
      req.url?.split('?', 1)[0] !== DEVTOOLS_JSON_PATH ||
      !isLoopback(req.socket?.remoteAddress)
    ) {
      next();
      return;
    }
    res.setHeader('content-type', 'application/json');
    res.end(body);
  };
};

/**
 * Lets Chrome DevTools connect the project as a workspace, so edits made in
 * the Sources panel save to disk. The root defaults to Vite's workspace root
 * (the monorepo root, not the app), since sources served from sibling
 * packages would otherwise fall outside it and stay unmapped.
 */
export const litDevtoolsWorkspace = (ctx: OptionsContext): Plugin => ({
  name: 'lit-devtools-workspace',
  apply: 'serve',
  configureServer(server) {
    const option = ctx.get().devtoolsWorkspace;
    if (option === false) return;
    const root =
      typeof option === 'string'
        ? resolvePath(server.config.root, option)
        : searchForWorkspaceRoot(server.config.root);
    server.middlewares.use(createDevtoolsJsonMiddleware(root));
  },
});
