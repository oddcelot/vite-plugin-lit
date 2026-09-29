import {resolve as resolvePath} from 'node:path';
import {confineToRoots} from '../confine.js';
import {toLaunchEditor} from '../devframe/launch-editor.js';
import {isTrustedRequest, type TrustHeaders} from '../http.js';

export const OPEN_IN_EDITOR_PATH = '/__lit-open-in-editor';

export const createOpenInEditorMiddleware = (
  allowedRoots: readonly string[]
) => {
  // First entry is the primary root: relative `file` params resolve against
  // it. Every entry grants open access to files beneath it.
  const roots = allowedRoots.map((r) => resolvePath(r));
  return (
    req: {url?: string; method?: string; headers?: TrustHeaders},
    res: {statusCode: number; end: (msg: string) => void},
    next: (err?: unknown) => void
  ) => {
    if (req.url === undefined) {
      next();
      return;
    }
    if (req.method !== undefined && req.method !== 'GET') {
      res.statusCode = 405;
      res.end('method not allowed');
      return;
    }
    if (!isTrustedRequest(req.headers ?? {})) {
      res.statusCode = 403;
      res.end('forbidden');
      return;
    }
    const query = req.url.includes('?')
      ? req.url.slice(req.url.indexOf('?') + 1)
      : '';
    const params = new URLSearchParams(query);
    const file = params.get('file');
    if (file === null) {
      res.statusCode = 400;
      res.end('missing file parameter');
      return;
    }
    // Confine the open to the allowed roots: `launch-editor` spawns the
    // user's editor on this path, so an unvalidated `file` is a
    // local-file-open / arg-injection vector.
    const confined = confineToRoots(roots, file);
    if ('failure' in confined) {
      const outside = confined.failure === 'outside';
      res.statusCode = outside ? 403 : 404;
      res.end(outside ? 'file outside allowed roots' : 'file not found');
      return;
    }
    const resolved = confined.path;
    // Coerce to integers so a crafted `line`/`column` can't smuggle extra
    // shell-visible content through the `file:line:column` ref.
    const line = String(
      Math.max(1, Number.parseInt(params.get('line') ?? '1', 10) || 1)
    );
    const column = String(
      Math.max(1, Number.parseInt(params.get('column') ?? '1', 10) || 1)
    );
    // The overlay names the editor it is using (the panel's override, else the
    // configured one). Only keys `toLaunchEditor` knows become a command;
    // anything else, or nothing, leaves `launch-editor` to auto-detect.
    const editor = toLaunchEditor(params.get('editor') ?? undefined);
    const fileRef = `${resolved}:${line}:${column}`;
    import('launch-editor')
      .then(
        (mod: {
          default?: (
            file: string,
            editor: string | undefined,
            cb: (fileName: string, errorMessage: string | null) => void
          ) => void;
        }) => {
          const launch = (mod.default ?? mod) as (
            file: string,
            editor: string | undefined,
            cb: (fileName: string, errorMessage: string | null) => void
          ) => void;
          // `launch-editor` invokes the callback only on failure — synchronously
          // when it can't guess an editor, later if the spawn errors. Reply `ok`
          // right after launching; the guard keeps a sync failure's 500 first
          // and drops a late async failure (the response is long gone).
          let finished = false;
          const finish = (statusCode: number, msg: string) => {
            if (finished) return;
            finished = true;
            res.statusCode = statusCode;
            res.end(msg);
          };
          launch(
            fileRef,
            editor,
            (_fileName: string, errorMessage: string | null) => {
              if (errorMessage !== null) {
                finish(500, errorMessage);
              }
            }
          );
          finish(200, 'ok');
        }
      )
      .catch(next);
  };
};
