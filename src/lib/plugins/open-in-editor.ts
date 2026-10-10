import {createSourceLocator, type SourceLocator} from '../source-locator.js';
import {toLaunchEditor} from '../devframe/launch-editor.js';
import {isTrustedRequest, type TrustHeaders} from '../http.js';

export const OPEN_IN_EDITOR_PATH = '/__lit-open-in-editor';

type Launch = (
  file: string,
  editor: string | undefined,
  cb: (fileName: string, errorMessage: string | null) => void
) => void;

type Res = {statusCode: number; end: (msg: string) => void};

/** The editor launch a request asks for, or the failure to answer with. */
type OpenRequest =
  | {fileRef: string; editor: string | undefined}
  | {status: number; message: string};

/** Validate a request and work out what to open; confines `file` to the roots. */
const parseOpenRequest = (
  req: {url: string; method?: string; headers?: TrustHeaders},
  locator: SourceLocator
): OpenRequest => {
  if (req.method !== undefined && req.method !== 'GET') {
    return {status: 405, message: 'method not allowed'};
  }
  if (!isTrustedRequest(req.headers ?? {})) {
    return {status: 403, message: 'forbidden'};
  }
  const query = req.url.includes('?')
    ? req.url.slice(req.url.indexOf('?') + 1)
    : '';
  const params = new URLSearchParams(query);
  const file = params.get('file');
  if (file === null) {
    return {status: 400, message: 'missing file parameter'};
  }
  // Confine the open to the allowed roots: `launch-editor` spawns the
  // user's editor on this path, so an unvalidated `file` is a
  // local-file-open / arg-injection vector.
  const confined = locator.resolve(file);
  if ('failure' in confined) {
    return confined.failure === 'outside'
      ? {status: 403, message: 'file outside allowed roots'}
      : {status: 404, message: 'file not found'};
  }
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
  return {
    fileRef: `${confined.path}:${line}:${column}`,
    editor: toLaunchEditor(params.get('editor') ?? undefined),
  };
};

/** Launch the editor and answer `ok`, or a 500 when it fails to start. */
const launchEditor = (
  mod: {default?: Launch},
  fileRef: string,
  editor: string | undefined,
  res: Res
) => {
  const launch = (mod.default ?? mod) as Launch;
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
  launch(fileRef, editor, (_fileName: string, errorMessage: string | null) => {
    if (errorMessage !== null) {
      finish(500, errorMessage);
    }
  });
  finish(200, 'ok');
};

/**
 * `allowedRoots` is a locator, or the roots to build one from: the first is
 * the primary root that relative `file` params resolve against, and every
 * entry grants open access to files beneath it.
 */
export const createOpenInEditorMiddleware = (
  allowedRoots: SourceLocator | readonly string[]
) => {
  const locator =
    'resolve' in allowedRoots
      ? allowedRoots
      : createSourceLocator(allowedRoots);
  return (
    req: {url?: string; method?: string; headers?: TrustHeaders},
    res: Res,
    next: (err?: unknown) => void
  ) => {
    if (req.url === undefined) {
      next();
      return;
    }
    const parsed = parseOpenRequest({...req, url: req.url}, locator);
    if ('status' in parsed) {
      res.statusCode = parsed.status;
      res.end(parsed.message);
      return;
    }
    import('launch-editor')
      .then((mod: {default?: Launch}) =>
        launchEditor(mod, parsed.fileRef, parsed.editor, res)
      )
      .catch(next);
  };
};
