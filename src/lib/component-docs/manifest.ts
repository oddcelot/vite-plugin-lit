/**
 * Reads a Custom Elements Manifest (`custom-elements.json`, schema 2.x) into
 * the flat per-tag `ComponentDocs` the panel shows.
 *
 * Manifests are written by tools and by hand, and a dependency's file is not
 * ours to trust: every read here is defensive. Anything that isn't the shape
 * the schema promises is skipped rather than thrown on, so one odd member
 * costs that member, not the component or the manifest. Optional keys are
 * left off instead of set to `undefined`, which keeps the result clean for
 * the JSON-serialised RPC it travels over.
 *
 * Pure and browser-safe: it takes the parsed JSON, not a path.
 */

import type {
  ComponentDocs,
  DocEntry,
  DocsOrigin,
} from '../../types/component-docs.js';

type Json = Record<string, unknown>;

const isRecord = (value: unknown): value is Json =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const asArray = (value: unknown): unknown[] =>
  Array.isArray(value) ? value : [];

/** A trimmed, non-empty string, or `undefined`. */
const text = (value: unknown): string | undefined => {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed === '' ? undefined : trimmed;
};

/** `true`, a non-empty reason, or `undefined` (`false` and junk both mean "not deprecated"). */
const deprecation = (value: unknown): boolean | string | undefined => {
  if (value === true) return true;
  return text(value);
};

/** Defaults are source text, but a hand-written manifest may use a bare literal. */
const sourceText = (value: unknown): string | undefined =>
  typeof value === 'number' || typeof value === 'boolean'
    ? String(value)
    : text(value);

const typeText = (value: unknown): string | undefined =>
  isRecord(value) ? text(value.text) : undefined;

const inheritedFrom = (value: unknown): string | undefined =>
  isRecord(value) ? text(value.name) : undefined;

/** Copies `value` onto `target[key]` only when there is one. */
const put = <T extends object, K extends keyof T>(
  target: T,
  key: K,
  value: T[K] | undefined
) => {
  if (value !== undefined) target[key] = value;
};

interface EntryOptions {
  /** Default slots have no name, and that is a valid entry. */
  allowEmptyName?: boolean;
  type?: string | undefined;
  counterpart?: string | undefined;
}

const entry = (
  raw: unknown,
  options: EntryOptions = {}
): DocEntry | undefined => {
  if (!isRecord(raw)) return undefined;
  const name =
    text(raw.name) ?? (options.allowEmptyName === true ? '' : undefined);
  if (name === undefined) return undefined;
  const result: DocEntry = {name};
  put(result, 'description', text(raw.description));
  put(result, 'type', options.type ?? typeText(raw.type));
  put(result, 'default', sourceText(raw.default));
  put(result, 'deprecated', deprecation(raw.deprecated));
  put(result, 'counterpart', options.counterpart);
  put(result, 'inheritedFrom', inheritedFrom(raw.inheritedFrom));
  return result;
};

const entries = (
  list: unknown,
  map: (raw: unknown) => DocEntry | undefined
): DocEntry[] =>
  asArray(list).flatMap((raw) => {
    const mapped = map(raw);
    return mapped === undefined ? [] : [mapped];
  });

const plain = (list: unknown, options?: EntryOptions): DocEntry[] =>
  entries(list, (raw) => entry(raw, options));

const isPublicInstanceField = (member: unknown): member is Json =>
  isRecord(member) &&
  member.kind === 'field' &&
  member.static !== true &&
  member.privacy !== 'private' &&
  member.privacy !== 'protected';

const declarationDocs = (
  declaration: Json,
  tagName: string,
  origin: DocsOrigin
): ComponentDocs => {
  const docs: ComponentDocs = {
    tagName,
    className: text(declaration.name) ?? '',
    properties: entries(
      asArray(declaration.members).filter(isPublicInstanceField),
      (field) =>
        entry(field, {
          counterpart: isRecord(field) ? text(field.attribute) : undefined,
        })
    ),
    attributes: entries(declaration.attributes, (attribute) =>
      entry(attribute, {
        counterpart: isRecord(attribute)
          ? text(attribute.fieldName)
          : undefined,
      })
    ),
    events: plain(declaration.events),
    slots: plain(declaration.slots, {allowEmptyName: true}),
    cssParts: plain(declaration.cssParts),
    cssProperties: entries(declaration.cssProperties, (property) =>
      entry(property, {
        type: isRecord(property) ? text(property.syntax) : undefined,
      })
    ),
    cssStates: plain(declaration.cssStates),
    origin,
  };
  put(docs, 'summary', text(declaration.summary));
  put(docs, 'description', text(declaration.description));
  put(docs, 'deprecated', deprecation(declaration.deprecated));
  return docs;
};

/**
 * Every custom element a manifest declares, as `ComponentDocs`. Never throws:
 * input that isn't a manifest gives `[]`, and malformed modules, declarations
 * or members are skipped.
 *
 * @param manifest The parsed `custom-elements.json`.
 * @param origin Where it came from; each result's `origin.module` is added
 *   from the declaring module's path.
 */
export const docsFromManifest = (
  manifest: unknown,
  origin: {package?: string; manifest: string}
): ComponentDocs[] => {
  if (!isRecord(manifest)) return [];
  const result: ComponentDocs[] = [];
  for (const module of asArray(manifest.modules)) {
    if (!isRecord(module)) continue;
    const modulePath = typeof module.path === 'string' ? module.path : '';
    for (const declaration of asArray(module.declarations)) {
      if (!isRecord(declaration) || declaration.customElement !== true)
        continue;
      const tagName = text(declaration.tagName);
      if (tagName === undefined) continue;
      const docsOrigin: DocsOrigin = {
        manifest: origin.manifest,
        module: modulePath,
      };
      put(docsOrigin, 'package', origin.package);
      result.push(declarationDocs(declaration, tagName, docsOrigin));
    }
  }
  return result;
};
