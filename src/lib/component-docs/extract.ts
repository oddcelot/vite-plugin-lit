/**
 * Reads a component's docs straight from its source, for the project's own
 * elements that have no Custom Elements Manifest. The dev server runs this
 * over each module it transforms; the result is per class, with the
 * superclass left unresolved, and `source-index.ts` joins classes across
 * modules into `ComponentDocs`.
 *
 * What it reads, in the analyzer's vocabulary: the tag from
 * `@customElement('x-y')` or `customElements.define('x-y', Class)`, the
 * class's JSDoc (`@summary`, `@deprecated`, `@fires`/`@event`, `@slot`,
 * `@csspart`, `@cssprop`/`@cssproperty`, `@cssstate`), and its public
 * instance fields and accessors with their JSDoc, declared type, initializer
 * and attribute (from `@property()` or `static properties`). Internal
 * reactive state (`@state()`, `state: true`) and private, protected, `#`
 * and static members are not API and are left out.
 *
 * Never throws: a module that doesn't parse documents nothing.
 */

import {parseAst} from 'vite';
import {langOf} from '../call-sites.js';
import type {ComponentDocs, DocEntry} from '../../types/component-docs.js';
import {
  type Node,
  child,
  docOf,
  findDecorator,
  nameOf,
  nodes,
  put,
  stringLiteral,
  walk,
} from './ast.js';
import {
  type JsDoc,
  cssPropertyEntry,
  deprecationOf,
  namedEntry,
  tagText,
} from './jsdoc.js';
import {attributesOf, propertiesOf} from './members.js';

/** `ComponentDocs` without what the index fills in. */
export type ClassDocsBody = Omit<
  ComponentDocs,
  'tagName' | 'className' | 'origin'
>;

export interface ClassDocs {
  name: string;
  /** Set when the module registers the class as a custom element. */
  tagName?: string;
  /** `true` for `export default class`. */
  isDefaultExport?: boolean;
  /**
   * The class it extends, when that is a plain identifier (a mixin call is
   * not followed). `name` is the name it is exported under where it comes
   * from (`default` for a default import), `specifier` the import source
   * when it is imported.
   */
  superclass?: {name: string; specifier?: string};
  docs: ClassDocsBody;
}

export interface ModuleDocs {
  classes: ClassDocs[];
}

// --- imports and registrations ---------------------------------------------

interface Imported {
  name: string;
  specifier: string;
}

/** Local binding to where it was imported from. */
const importsOf = (program: Node): Map<string, Imported> => {
  const imports = new Map<string, Imported>();
  for (const statement of nodes(program.body)) {
    if (statement.type !== 'ImportDeclaration') continue;
    const specifier = stringLiteral(child(statement, 'source'));
    if (specifier === undefined) continue;
    for (const spec of nodes(statement.specifiers)) {
      const local = nameOf(child(spec, 'local'));
      const imported =
        spec.type === 'ImportSpecifier'
          ? nameOf(child(spec, 'imported'))
          : 'default';
      if (local !== undefined && imported !== undefined)
        imports.set(local, {name: imported, specifier});
    }
  }
  return imports;
};

/** `customElements.define` / `window.customElements.define`. */
const isDefineCallee = (callee: Node | undefined): boolean => {
  if (callee?.type !== 'MemberExpression') return false;
  if (nameOf(child(callee, 'property')) !== 'define') return false;
  const object = child(callee, 'object');
  return (
    nameOf(object) === 'customElements' ||
    nameOf(child(object, 'property')) === 'customElements'
  );
};

/** Class name to tag, from `customElements.define('x-y', XY)` calls. */
const definedTags = (program: Node): Map<string, string> => {
  const tags = new Map<string, string>();
  for (const node of walk(program)) {
    if (node.type !== 'CallExpression') continue;
    if (!isDefineCallee(child(node, 'callee'))) continue;
    const [tag, cls] = nodes(node.arguments);
    const tagName = stringLiteral(tag);
    const className = cls?.type === 'Identifier' ? nameOf(cls) : undefined;
    if (tagName !== undefined && className !== undefined)
      tags.set(className, tagName);
  }
  return tags;
};

// --- classes ---------------------------------------------------------------

const taggedEntries = (
  doc: JsDoc | undefined,
  tags: string[],
  read: (text: string) => DocEntry = namedEntry
): DocEntry[] =>
  (doc?.tags ?? [])
    .filter((t) => tags.includes(t.tag))
    .map((t) => read(t.text));

const bodyOf = (code: string, cls: Node, doc: JsDoc | undefined) => {
  const properties = propertiesOf(code, cls);
  const docs: ClassDocsBody = {
    properties,
    attributes: attributesOf(properties),
    events: taggedEntries(doc, ['fires', 'event']),
    slots: taggedEntries(doc, ['slot']),
    cssParts: taggedEntries(doc, ['csspart']),
    cssProperties: taggedEntries(
      doc,
      ['cssprop', 'cssproperty'],
      cssPropertyEntry
    ),
    cssStates: taggedEntries(doc, ['cssstate']),
  };
  put(docs, 'summary', tagText(doc, 'summary'));
  put(docs, 'description', doc?.description);
  put(docs, 'deprecated', deprecationOf(doc));
  return docs;
};

const superclassOf = (
  cls: Node,
  imports: Map<string, Imported>
): ClassDocs['superclass'] => {
  const superClass = child(cls, 'superClass');
  if (superClass?.type !== 'Identifier') return undefined;
  const local = nameOf(superClass)!;
  return imports.get(local) ?? {name: local};
};

interface ClassSite {
  cls: Node;
  wrapper?: Node;
}

/** Top-level class declarations, with the `export` around them. */
const classSites = (program: Node): ClassSite[] =>
  nodes(program.body).flatMap((statement): ClassSite[] => {
    if (statement.type === 'ClassDeclaration') return [{cls: statement}];
    const declaration = child(statement, 'declaration');
    if (
      statement.type.startsWith('Export') &&
      declaration?.type === 'ClassDeclaration'
    )
      return [{cls: declaration, wrapper: statement}];
    return [];
  });

const classDocs = (
  code: string,
  site: ClassSite,
  context: {imports: Map<string, Imported>; defined: Map<string, string>}
): ClassDocs | undefined => {
  const {cls, wrapper} = site;
  const isDefault = wrapper?.type === 'ExportDefaultDeclaration';
  const name = nameOf(child(cls, 'id')) ?? (isDefault ? 'default' : undefined);
  if (name === undefined) return undefined;
  const result: ClassDocs = {
    name,
    docs: bodyOf(code, cls, docOf(code, cls, wrapper)),
  };
  put(
    result,
    'tagName',
    stringLiteral(findDecorator(cls, 'customElement')?.args[0]) ??
      context.defined.get(name)
  );
  if (isDefault) result.isDefaultExport = true;
  put(result, 'superclass', superclassOf(cls, context.imports));
  return result;
};

/**
 * The classes `code` declares at its top level, with their docs. `id` is the
 * module's id; its extension picks the parser's language.
 */
export const extractModuleDocs = (code: string, id: string): ModuleDocs => {
  const [file] = id.split('?', 1);
  let program: Node;
  try {
    program = parseAst(
      code,
      {sourceType: 'module', lang: langOf(file)},
      file
    ) as unknown as Node;
  } catch {
    return {classes: []};
  }
  const context = {
    imports: importsOf(program),
    defined: definedTags(program),
  };
  return {
    classes: classSites(program).flatMap((site) => {
      const docs = classDocs(code, site, context);
      return docs === undefined ? [] : [docs];
    }),
  };
};
