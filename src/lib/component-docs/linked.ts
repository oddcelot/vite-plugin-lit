/**
 * Component docs for a host with no disk: the Custom Elements Manifests the
 * inspected page itself advertises with
 * `<link rel="custom-elements-manifest" href="…">`, the discovery convention
 * Web Component DevTools proposed (its RFC #76). The browser extension uses
 * it; the Vite plugin adds such links to the pages it serves.
 *
 * Browser-safe and free of extension APIs: the host says how to read the
 * page's links (already absolute, so a `<base>` is honoured), how to fetch
 * one, and which URLs it may fetch at all.
 */

import type {ComponentDocs} from '../../types/component-docs.js';
import type {
  ComponentDocsArgs,
  ComponentDocsResult,
} from '../devframe/protocol.js';
import {docsFromManifest} from './manifest.js';

/** The `rel` a page names its manifests with. */
export const MANIFEST_LINK_REL = 'custom-elements-manifest';

export interface LinkedDocsOptions {
  /** The absolute URLs of the page's manifest links, in document order. */
  links(): Promise<string[]>;
  /** The text at `url`, or `undefined` when it can't be read. */
  fetchText(url: string): Promise<string | undefined>;
  /** Whether the host may fetch `url`; a refused one is skipped. */
  allows(url: string): boolean;
}

export interface LinkedDocsSource {
  componentDocs(args: ComponentDocsArgs): Promise<ComponentDocsResult>;
  /** Forget fetched manifests, as when the page navigates. */
  reset(): void;
}

const parse = (text: string | undefined, url: string): ComponentDocs[] => {
  if (text === undefined) return [];
  try {
    return docsFromManifest(JSON.parse(text), {manifest: url});
  } catch {
    return [];
  }
};

export const createLinkedDocsSource = (
  options: LinkedDocsOptions
): LinkedDocsSource => {
  // One fetch per manifest until reset, shared by concurrent lookups.
  let parsed = new Map<string, Promise<ComponentDocs[]>>();

  const docsAt = (url: string): Promise<ComponentDocs[]> => {
    let docs = parsed.get(url);
    if (docs === undefined) {
      docs = options.fetchText(url).then(
        (text) => parse(text, url),
        () => []
      );
      parsed.set(url, docs);
    }
    return docs;
  };

  return {
    async componentDocs({tagName}) {
      const links = await options.links().catch(() => []);
      for (const url of links) {
        if (!options.allows(url)) continue;
        const match = (await docsAt(url)).find((d) => d.tagName === tagName);
        if (match !== undefined) return {docs: match};
      }
      return {docs: null};
    },
    reset() {
      parsed = new Map();
    },
  };
};
