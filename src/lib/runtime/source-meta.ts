/** Runtime accessor for injected component source metadata. */
export const SOURCE_META_KEY = Symbol.for('@oddsquad/vite-plugin-lit#source');

export interface LitSourceMeta {
  filePath: string;
  lineNumber: number;
  componentName?: string;
}

export type CustomElementConstructorWithMeta = CustomElementConstructor & {
  [SOURCE_META_KEY]?: LitSourceMeta;
};

/**
 * Attribute the transform stamps on custom elements written in `html`
 * templates: `<wire-file>:<line>:<column>` of the opening `<`.
 */
export const CALL_SITE_ATTR = 'data-lit-source';

/** Where an instance is written in an `html` template. */
export interface CallSite {
  filePath: string;
  lineNumber: number;
  columnNumber: number;
}

/**
 * The call site the transform stamped on `el`, if any. Parsed from the right:
 * the file part may itself hold colons (a Windows drive).
 */
export const readCallSite = (el: Element): CallSite | undefined => {
  const match = /^(.*):(\d+):(\d+)$/.exec(
    el.getAttribute(CALL_SITE_ATTR) ?? ''
  );
  return match === null
    ? undefined
    : {
        filePath: match[1]!,
        lineNumber: Number(match[2]),
        columnNumber: Number(match[3]),
      };
};
