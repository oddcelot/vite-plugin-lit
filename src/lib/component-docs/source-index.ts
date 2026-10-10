/**
 * The docs the dev server has read from the project's own source, one entry
 * per transformed module, joined into `ComponentDocs` on demand.
 *
 * Inheritance is resolved at read time rather than when a module is stored:
 * a base class may be transformed after its subclass, and an edit to it
 * should show in every subclass without re-reading them. A superclass is
 * followed while it is in the index (same module by name, another module
 * through the import id the plugin resolved) and the walk stops at the first
 * one that isn't, such as `LitElement`. Members a subclass redeclares win.
 */

import type {ComponentDocs, DocEntry} from '../../types/component-docs.js';
import type {ClassDocs, ClassDocsBody, ModuleDocs} from './extract.js';

export interface SourceDocsIndex {
  /**
   * Stores a module's classes, replacing what it held before.
   *
   * @param superclassIds Each imported superclass specifier, resolved to a
   *   module id; specifiers that didn't resolve are left out.
   */
  set(
    id: string,
    module: ModuleDocs,
    superclassIds: ReadonlyMap<string, string>
  ): void;
  delete(id: string): void;
  get(tagName: string): ComponentDocs | undefined;
}

interface Entry {
  module: ModuleDocs;
  superclassIds: ReadonlyMap<string, string>;
}

interface Located {
  id: string;
  cls: ClassDocs;
}

type ListKey = Exclude<
  keyof ClassDocsBody,
  'summary' | 'description' | 'deprecated'
>;

const LISTS: ListKey[] = [
  'properties',
  'attributes',
  'events',
  'slots',
  'cssParts',
  'cssProperties',
  'cssStates',
];

const stripQuery = (id: string): string => id.split('?', 1)[0];

const findClass = (
  entry: Entry | undefined,
  name: string
): ClassDocs | undefined =>
  entry?.module.classes.find((cls) =>
    name === 'default' ? cls.isDefaultExport === true : cls.name === name
  );

/** Appends `inherited` entries `own` doesn't already name. */
const mergeList = (
  own: DocEntry[],
  inherited: DocEntry[],
  from: string
): DocEntry[] => {
  const names = new Set(own.map((entry) => entry.name));
  return [
    ...own,
    ...inherited
      .filter((entry) => !names.has(entry.name))
      .map((entry) => ({inheritedFrom: from, ...entry})),
  ];
};

/**
 * @param relative Turns a module id into the path the panel shows, relative
 *   to the Vite root.
 */
export const createSourceDocsIndex = (
  relative: (id: string) => string
): SourceDocsIndex => {
  const modules = new Map<string, Entry>();

  const superclassOf = (at: Located): Located | undefined => {
    const superclass = at.cls.superclass;
    if (superclass === undefined) return undefined;
    const resolved =
      superclass.specifier === undefined
        ? at.id
        : modules.get(at.id)?.superclassIds.get(superclass.specifier);
    if (resolved === undefined) return undefined;
    const id = stripQuery(resolved);
    const cls = findClass(modules.get(id), superclass.name);
    return cls === undefined ? undefined : {id, cls};
  };

  const locate = (tagName: string): Located | undefined => {
    for (const [id, entry] of modules) {
      const cls = entry.module.classes.find((c) => c.tagName === tagName);
      if (cls !== undefined) return {id, cls};
    }
    return undefined;
  };

  const docsFor = (tagName: string, start: Located): ComponentDocs => {
    const docs: ComponentDocs = {
      ...structuredClone(start.cls.docs),
      tagName,
      className: start.cls.name,
      origin: {manifest: '', module: relative(start.id), source: true},
    };
    const seen = new Set([`${start.id}#${start.cls.name}`]);
    for (
      let at = superclassOf(start);
      at !== undefined;
      at = superclassOf(at)
    ) {
      const key = `${at.id}#${at.cls.name}`;
      if (seen.has(key)) break;
      seen.add(key);
      for (const list of LISTS)
        docs[list] = mergeList(docs[list], at.cls.docs[list], at.cls.name);
    }
    return docs;
  };

  return {
    set(id, module, superclassIds) {
      modules.set(stripQuery(id), {module, superclassIds});
    },
    delete(id) {
      modules.delete(stripQuery(id));
    },
    get(tagName) {
      const start = locate(tagName);
      return start === undefined ? undefined : docsFor(tagName, start);
    },
  };
};
