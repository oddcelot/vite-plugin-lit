/** Runtime accessor for injected component source metadata. */
export const SOURCE_META_KEY = Symbol.for('@lit-labs/vite-plugin-lit#source');

export interface LitSourceMeta {
  filePath: string;
  lineNumber: number;
  componentName?: string;
}

export type CustomElementConstructorWithMeta = CustomElementConstructor & {
  [SOURCE_META_KEY]?: LitSourceMeta;
};
