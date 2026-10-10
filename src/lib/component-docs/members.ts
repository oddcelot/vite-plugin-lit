/**
 * A class's public properties and the attributes they map to, read from its
 * fields, accessors, `@property()` / `@state()` decorators and
 * `static properties`. See `extract.ts` for what counts as public.
 */

import type {DocEntry} from '../../types/component-docs.js';
import {
  type Node,
  child,
  decoratorCall,
  docOf,
  nameOf,
  nodes,
  put,
  stringLiteral,
} from './ast.js';
import {type JsDoc, deprecationOf, jsDocBefore, tagText} from './jsdoc.js';

/** What `@property()` or a `static properties` entry declares. */
interface Reactive {
  /** The attribute, or `false` for `attribute: false`. */
  attribute?: string | false;
  /** `type: Number` → `number`. */
  type?: string;
  state?: boolean;
}

const optionValue = (options: Node | undefined, key: string) =>
  nodes(options?.properties).find(
    (p) => p.type === 'Property' && nameOf(child(p, 'key')) === key
  );

const reactiveFrom = (options: Node | undefined, state = false): Reactive => {
  const reactive: Reactive = {state};
  const attribute = child(optionValue(options, 'attribute'), 'value');
  if (attribute?.type === 'Literal' && attribute.value === false)
    reactive.attribute = false;
  else put(reactive, 'attribute', stringLiteral(attribute));
  const type = nameOf(child(optionValue(options, 'type'), 'value'));
  if (type !== undefined) reactive.type = type.toLowerCase();
  const isState = child(optionValue(options, 'state'), 'value');
  if (isState?.type === 'Literal' && isState.value === true)
    reactive.state = true;
  return reactive;
};

/** `@property(...)` / `@state()` on a member. */
const decoratedReactive = (member: Node): Reactive | undefined => {
  for (const call of nodes(member.decorators).map(decoratorCall)) {
    if (call.name === 'property') return reactiveFrom(call.args[0]);
    if (call.name === 'state' || call.name === 'internalProperty')
      return {state: true};
  }
  return undefined;
};

/** What a function's top-level `return` returns. */
const returnedValue = (fn: Node | undefined): Node | undefined => {
  const body = nodes(child(fn, 'body')?.body);
  return child(
    body.find((s) => s.type === 'ReturnStatement'),
    'argument'
  );
};

/** The object literal `static properties` holds or its getter returns. */
const staticPropertiesObject = (member: Node): Node | undefined => {
  if (member.static !== true) return undefined;
  if (nameOf(child(member, 'key')) !== 'properties') return undefined;
  const value = child(member, 'value');
  const object = member.kind === 'get' ? returnedValue(value) : value;
  return object?.type === 'ObjectExpression' ? object : undefined;
};

interface StaticProperty extends Reactive {
  name: string;
  doc?: JsDoc;
}

/** The entries of a `static properties = {...}` declaration. */
const staticProperties = (code: string, body: Node[]): StaticProperty[] => {
  const object = body.map(staticPropertiesObject).find(Boolean);
  return nodes(object?.properties).flatMap((property) => {
    const name = nameOf(child(property, 'key'));
    if (property.type !== 'Property' || name === undefined) return [];
    const result: StaticProperty = {
      name,
      ...reactiveFrom(child(property, 'value')),
    };
    put(result, 'doc', jsDocBefore(code, property.start));
    return [result];
  });
};

const FIELD_TYPES = new Set(['PropertyDefinition', 'AccessorProperty']);
const ACCESSOR_KINDS = new Set(['get', 'set']);
const HIDDEN_ACCESS = new Set(['private', 'protected']);
const HIDDEN_TAGS = new Set(['private', 'protected', 'internal', 'ignore']);

/** A public instance field or accessor's name, or `undefined` for anything else. */
const publicMemberName = (member: Node): string | undefined => {
  const isFieldOrAccessor =
    FIELD_TYPES.has(member.type) ||
    (member.type === 'MethodDefinition' &&
      ACCESSOR_KINDS.has(member.kind as string));
  if (!isFieldOrAccessor || member.static === true || member.computed === true)
    return undefined;
  if (HIDDEN_ACCESS.has(member.accessibility as string)) return undefined;
  const key = child(member, 'key');
  return key?.type === 'Identifier' ? nameOf(key) : undefined;
};

const sliceOf = (code: string, node: Node | undefined): string | undefined =>
  node === undefined ? undefined : code.slice(node.start, node.end).trim();

/** The member's declared type: its annotation, a getter's return type or a setter's parameter type. */
const annotationOf = (member: Node): Node | undefined => {
  if (member.type !== 'MethodDefinition')
    return child(child(member, 'typeAnnotation'), 'typeAnnotation');
  const fn = child(member, 'value');
  if (member.kind === 'get')
    return child(child(fn, 'returnType'), 'typeAnnotation');
  const [param] = nodes(fn?.params);
  return child(child(param, 'typeAnnotation'), 'typeAnnotation');
};

/** A JS `@type {X}`'s `X`. */
const jsDocType = (doc: JsDoc | undefined): string | undefined =>
  /^\{(.*)\}/.exec(tagText(doc, 'type') ?? '')?.[1]?.trim() || undefined;

const describe = (entry: DocEntry, doc: JsDoc | undefined): DocEntry => {
  put(entry, 'description', doc?.description);
  put(entry, 'deprecated', deprecationOf(doc));
  return entry;
};

/** The attribute a reactive property maps to: Lit lowercases the name by default. */
const attributeOf = (
  name: string,
  reactive: Reactive | undefined
): string | undefined => {
  if (reactive === undefined || reactive.attribute === false) return undefined;
  return reactive.attribute ?? name.toLowerCase();
};

const isHidden = (doc: JsDoc | undefined): boolean =>
  doc?.tags.some((t) => HIDDEN_TAGS.has(t.tag)) ?? false;

/** The annotation's text, else a JS `@type`, else the `type:` option's. */
const memberType = (
  code: string,
  member: Node,
  doc: JsDoc | undefined,
  reactive: Reactive | undefined
): string | undefined =>
  sliceOf(code, annotationOf(member)) ?? jsDocType(doc) ?? reactive?.type;

/** A field's initializer as source text; an accessor's `value` is its function. */
const initializerOf = (code: string, member: Node): string | undefined =>
  member.type === 'MethodDefinition'
    ? undefined
    : sliceOf(code, child(member, 'value'));

/** One member's entry, or `undefined` when it isn't public API. */
const memberEntry = (
  code: string,
  member: Node,
  statics: Map<string, StaticProperty>
): DocEntry | undefined => {
  const name = publicMemberName(member);
  if (name === undefined) return undefined;
  const reactive = decoratedReactive(member) ?? statics.get(name);
  const doc = docOf(code, member) ?? statics.get(name)?.doc;
  if (reactive?.state === true || isHidden(doc)) return undefined;
  const entry = describe({name}, doc);
  put(entry, 'type', memberType(code, member, doc, reactive));
  put(entry, 'default', initializerOf(code, member));
  put(entry, 'counterpart', attributeOf(name, reactive));
  return entry;
};

/** A `static properties` entry with no field of its own. */
const staticEntry = (property: StaticProperty): DocEntry | undefined => {
  if (property.state === true || isHidden(property.doc)) return undefined;
  const entry = describe({name: property.name}, property.doc);
  put(entry, 'type', jsDocType(property.doc) ?? property.type);
  put(entry, 'counterpart', attributeOf(property.name, property));
  return entry;
};

export const propertiesOf = (code: string, cls: Node): DocEntry[] => {
  const body = nodes(child(cls, 'body')?.body);
  const statics = new Map(staticProperties(code, body).map((p) => [p.name, p]));
  const seen = new Set<string>();
  const result: DocEntry[] = [];
  const add = (entry: DocEntry | undefined) => {
    if (entry === undefined || seen.has(entry.name)) return;
    seen.add(entry.name);
    result.push(entry);
  };
  // A getter and its setter share a name; the first one documents it.
  for (const member of body) add(memberEntry(code, member, statics));
  for (const property of statics.values()) add(staticEntry(property));
  return result;
};

/** An attribute entry per property that has one. */
export const attributesOf = (properties: DocEntry[]): DocEntry[] =>
  properties.flatMap((property) => {
    if (property.counterpart === undefined) return [];
    const {inheritedFrom: _, ...rest} = property;
    return [{...rest, name: property.counterpart, counterpart: property.name}];
  });
