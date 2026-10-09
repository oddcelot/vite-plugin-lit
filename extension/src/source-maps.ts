/**
 * Where a component is defined, on a page the plugin never built: the stack
 * of its `customElements.define` call (`runtime/define-sites.ts`) mapped
 * through the page's own sourcemaps.
 *
 * Runs in the DevTools panel page, which may fetch from the sites the user
 * enabled. Per generated script it fetches the script once, finds its map
 * (the `SourceMap` header, else the last `sourceMappingURL` comment; inline
 * `data:` maps too) and keeps the parsed map until {@link reset}.
 *
 * Which frame names the component: the define call's stack starts in
 * library code (`@customElement`, a registration helper) before reaching the
 * module that declares the class. So the first mapped frame outside
 * `node_modules` wins; failing that, the first outside Lit's own packages (a
 * component library's element); failing that, the first mapped frame.
 *
 * Anything going wrong (no map, a network error, a map that does not parse)
 * leaves the location unknown; nothing here throws.
 */

import {
  FlattenMap,
  isIgnored,
  originalPositionFor,
  type TraceMap,
} from '@jridgewell/trace-mapping';
import type {ElementSource, GeneratedFrame} from '../../src/types/inspector.js';

export interface SourceMapResolver {
  /** The original location of the first fitting frame, if any maps. */
  resolve(
    frames: readonly GeneratedFrame[]
  ): Promise<ElementSource | undefined>;
  /** Forget fetched scripts and maps (the page navigated). */
  reset(): void;
}

export interface SourceMapResolverOptions {
  fetch: typeof fetch;
  /**
   * Whether a script or map URL may be fetched; the panel allows only the
   * inspected site, so a CDN's script or a map hosted elsewhere stays
   * unresolved. Everything when omitted.
   */
  allows?: (url: string) => boolean;
}

const SOURCE_MAPPING_RE = /\/\/[#@]\s*sourceMappingURL=\s*(\S+)\s*$/gm;

/** The last `sourceMappingURL` comment's value in `code`. */
export const sourceMappingUrlOf = (code: string): string | undefined => {
  let last: string | undefined;
  for (const match of code.matchAll(SOURCE_MAPPING_RE)) last = match[1];
  return last;
};

/** The JSON text of a `data:` URL, base64 or percent-encoded. */
export const decodeDataUrl = (url: string): string => {
  const comma = url.indexOf(',');
  if (comma < 0) throw new Error('malformed data: URL');
  const meta = url.slice(5, comma);
  const payload = url.slice(comma + 1);
  if (/;base64$/i.test(meta)) {
    const binary = atob(payload);
    const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  }
  return decodeURIComponent(payload);
};

/**
 * A readable path for a resolved source URL: `webpack://app/./src/a.ts` and
 * `http://host/src/a.ts` both read `src/a.ts`; a `file:` URL keeps its
 * absolute path.
 */
export const displayPath = (source: string): string => {
  let path = source;
  if (/^file:\/\//i.test(path)) {
    path = path.replace(/^file:\/\/[^/]*/i, '');
  } else {
    path = path
      .replace(/^[a-z][\w+.-]*:\/\/[^/]*/i, '')
      .replace(/[?#].*$/, '')
      .replace(/^(?:\.?\/)+/, '');
  }
  try {
    return decodeURIComponent(path);
  } catch {
    return path;
  }
};

const NODE_MODULES_RE = /(?:^|\/)node_modules\//;
const LIT_PACKAGE_RE =
  /(?:^|\/)node_modules\/(?:lit|lit-element|lit-html|@lit|@lit-labs)\//;

interface Mapped {
  frame: GeneratedFrame;
  source: string;
  line: number;
  /** 0-based, as the map has it. */
  column: number;
  ignored: boolean;
}

export const createSourceMapResolver = (
  options: SourceMapResolverOptions
): SourceMapResolver => {
  let maps = new Map<string, Promise<TraceMap | undefined>>();

  const allows = options.allows ?? (() => true);

  const loadMap = async (scriptUrl: string): Promise<TraceMap | undefined> => {
    try {
      if (!allows(scriptUrl)) return undefined;
      const res = await options.fetch(scriptUrl);
      if (!res.ok) return undefined;
      const header =
        res.headers.get('SourceMap') ?? res.headers.get('X-SourceMap');
      const ref = header ?? sourceMappingUrlOf(await res.text());
      if (ref === undefined || ref === '') return undefined;
      if (/^data:/i.test(ref)) {
        return new FlattenMap(decodeDataUrl(ref), scriptUrl);
      }
      const mapUrl = new URL(ref, scriptUrl).href;
      if (!allows(mapUrl)) return undefined;
      const mapRes = await options.fetch(mapUrl);
      if (!mapRes.ok) return undefined;
      return new FlattenMap(await mapRes.text(), mapUrl);
    } catch {
      return undefined;
    }
  };

  const mapOf = (scriptUrl: string): Promise<TraceMap | undefined> => {
    let map = maps.get(scriptUrl);
    if (map === undefined) {
      map = loadMap(scriptUrl);
      maps.set(scriptUrl, map);
    }
    return map;
  };

  const mapFrame = async (
    frame: GeneratedFrame
  ): Promise<Mapped | undefined> => {
    const map = await mapOf(frame.url);
    if (map === undefined) return undefined;
    try {
      // The browser prints 1-based columns; trace-mapping wants 0-based.
      const pos = originalPositionFor(map, {
        line: frame.line,
        column: Math.max(0, frame.column - 1),
      });
      if (pos.source === null) return undefined;
      return {
        frame,
        source: pos.source,
        line: pos.line,
        column: pos.column,
        ignored: isIgnored(map, pos.source),
      };
    } catch {
      return undefined;
    }
  };

  return {
    async resolve(frames) {
      const mapped = (await Promise.all(frames.map(mapFrame))).filter(
        (m): m is Mapped => m !== undefined
      );
      const pick =
        mapped.find((m) => !m.ignored && !NODE_MODULES_RE.test(m.source)) ??
        mapped.find((m) => !LIT_PACKAGE_RE.test(m.source)) ??
        mapped[0];
      if (pick === undefined) return undefined;
      return {
        file: displayPath(pick.source),
        line: pick.line,
        // ElementSource columns are 1-based, as call sites are.
        column: pick.column + 1,
        url: pick.source,
        generated: pick.frame,
      };
    },
    reset() {
      maps = new Map();
    },
  };
};
