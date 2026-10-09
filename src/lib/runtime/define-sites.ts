/**
 * Where each custom element class was defined, read off the stack of its
 * `customElements.define` call.
 *
 * The plugin's transform stamps a class with its source file, but a page the
 * plugin never built has no stamp. What it may have is a sourcemap, and the
 * define call's stack gives the generated positions to map through it. This
 * module only records those positions; resolving them takes fetching the
 * page's scripts, which is the host's job (the extension's panel does it).
 *
 * Only defines made after {@link installDefineSites} runs are seen, so it has
 * to run before the page's own scripts: the extension injects it at
 * `document_start`.
 */

import type {GeneratedFrame} from '../../types/inspector.js';

/** Frames kept per define call, innermost first. */
const MAX_FRAMES = 8;
/** Frames the stack is asked for: ours, Lit's and the bundler's come first. */
const STACK_DEPTH = 20;

const framesByCtor = new WeakMap<object, GeneratedFrame[]>();

// Events and tree nodes name a class by a small number rather than by its
// frames, which would ride along on every one of them; the host asks for the
// frames of each number once. Ids belong to this page runtime.
const idByCtor = new WeakMap<object, number>();
const framesById = new Map<number, GeneratedFrame[]>();
let nextDefineId = 0;

// V8: `    at fn (https://host/a.js:10:5)` or `    at https://host/a.js:10:5`;
// Firefox and Safari: `fn@https://host/a.js:10:5`. Only http(s) frames count:
// anything else is our own wrapper (chrome-extension://), an eval or native.
const FRAME_RE = /(?:^\s*at (?:.*?\()?|@)(https?:\/\/[^\s()]+):(\d+):(\d+)\)?$/;

/**
 * The http(s) frames of an `Error.stack`, innermost first, at most `max`.
 * Lines it cannot read are skipped, so the message line and foreign frames
 * fall out.
 */
export const parseStackFrames = (
  stack: string,
  max = MAX_FRAMES
): GeneratedFrame[] => {
  const frames: GeneratedFrame[] = [];
  for (const line of stack.split('\n')) {
    const match = FRAME_RE.exec(line);
    if (match === null) continue;
    frames.push({
      url: match[1]!,
      line: Number(match[2]),
      column: Number(match[3]),
    });
    if (frames.length >= max) break;
  }
  return frames;
};

/** Records `frames` as where `ctor` was defined. */
export const rememberDefineFrames = (
  ctor: object,
  frames: GeneratedFrame[]
): void => {
  if (frames.length === 0) return;
  framesByCtor.set(ctor, frames);
  let id = idByCtor.get(ctor);
  if (id === undefined) {
    id = nextDefineId++;
    idByCtor.set(ctor, id);
  }
  // A repeated record replaces the frames under the same id. The map holds
  // them by id, not by class, so a class that is collected leaves its frames
  // behind: at most eight small frames per defined element.
  framesById.set(id, frames);
};

/** Where `ctor` was defined, when a define call was seen for it. */
export const defineFramesOf = (ctor: object): GeneratedFrame[] | undefined =>
  framesByCtor.get(ctor);

/** The id events and tree nodes use for `ctor`'s define call, when one was seen. */
export const defineIdOf = (ctor: object): number | undefined =>
  idByCtor.get(ctor);

/** The frames behind a {@link defineIdOf} id; `undefined` for one never issued. */
export const defineFramesById = (id: number): GeneratedFrame[] | undefined =>
  framesById.get(id);

const captureStack = (): string => {
  const limited = Error as {stackTraceLimit?: number};
  const saved = limited.stackTraceLimit;
  if (typeof saved === 'number') limited.stackTraceLimit = STACK_DEPTH;
  try {
    return new Error().stack ?? '';
  } finally {
    if (typeof saved === 'number') limited.stackTraceLimit = saved;
  }
};

const INSTALLED = Symbol.for('@oddsquad/vite-plugin-lit#define-sites');

/**
 * Wraps `customElements.define` to record each call's stack. Idempotent, and
 * chains with whatever wraps `define` before or after it: it calls the
 * function it found and returns its result.
 */
export const installDefineSites = (): void => {
  if (typeof customElements === 'undefined') return;
  const registry = customElements as CustomElementRegistry &
    Record<symbol, unknown>;
  if (registry[INSTALLED] === true) return;
  registry[INSTALLED] = true;
  const original = registry.define.bind(registry);
  registry.define = (
    name: string,
    ctor: CustomElementConstructor,
    options?: ElementDefinitionOptions
  ): void => {
    try {
      if (typeof ctor === 'function' && !framesByCtor.has(ctor)) {
        rememberDefineFrames(ctor, parseStackFrames(captureStack()));
      }
    } catch {
      // Recording is best-effort; the define itself must go through.
    }
    original(name, ctor, options);
  };
};
