/**
 * A component's documented API, as a Custom Elements Manifest describes it.
 *
 * The panel already reads a component's real properties, attributes, slots
 * and parts from the live element; a manifest adds what the runtime can't
 * see: descriptions, declared types, events the class fires, CSS custom
 * properties it reads. These types are that subset, flattened per tag so the
 * panel needs no knowledge of the manifest schema.
 *
 * Manifests come from whatever tool the project or a dependency used (the
 * `@custom-elements-manifest/analyzer`, `cem`, a hand-written file); members
 * a manifest lists as inherited (`inheritedFrom`) are kept, so a declaration
 * carries its base classes' members too when its generator resolved them.
 */

/** One documented member: a property, attribute, event, slot, part or CSS property. */
export interface DocEntry {
  /** Empty for a default slot. */
  name: string;
  description?: string;
  /** The declared type text, e.g. `'small' | 'medium' | 'large'`. */
  type?: string;
  /** The default value as source text. */
  default?: string;
  /** `true` for a bare `@deprecated`, or its reason. */
  deprecated?: boolean | string;
  /** For a property: the attribute it maps to. For an attribute: its property. */
  counterpart?: string;
  /** The class the manifest says it was inherited from. */
  inheritedFrom?: string;
}

/** Where a component's docs came from. */
export interface DocsOrigin {
  /** The package that ships the manifest; absent for the project's own. */
  package?: string;
  /**
   * The manifest file, relative to the package (or project) root. Empty when
   * the docs were read from source.
   */
  manifest: string;
  /**
   * The declaring module's path, as the manifest gives it, or relative to
   * the Vite root when read from source.
   */
  module: string;
  /**
   * Set when the dev server read the docs from the project's own source (its
   * JSDoc and declarations) rather than from a manifest.
   */
  source?: true;
}

export interface ComponentDocs {
  tagName: string;
  /** The declaring class's name. */
  className: string;
  summary?: string;
  description?: string;
  deprecated?: boolean | string;
  /** Public fields only; private and protected members are dropped. */
  properties: DocEntry[];
  attributes: DocEntry[];
  events: DocEntry[];
  slots: DocEntry[];
  cssParts: DocEntry[];
  cssProperties: DocEntry[];
  cssStates: DocEntry[];
  origin: DocsOrigin;
}
