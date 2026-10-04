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
