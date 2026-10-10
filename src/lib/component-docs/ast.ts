/**
 * The small ESTree toolkit the source-docs extractor reads `parseAst` output
 * with: typed child access, string and identifier reads, decorators, and the
 * doc comment that belongs to a declaration.
 */

import {type JsDoc, jsDocAfter, jsDocBefore} from './jsdoc.js';

export type Node = Record<string, unknown> & {
  type: string;
  start: number;
  end: number;
};

const isNode = (value: unknown): value is Node =>
  value !== null &&
  typeof value === 'object' &&
  typeof (value as Node).type === 'string';

export const nodes = (value: unknown): Node[] =>
  Array.isArray(value) ? value.filter(isNode) : [];

export const child = (
  node: Node | undefined,
  key: string
): Node | undefined => {
  const value = node?.[key];
  return isNode(value) ? value : undefined;
};

export const nameOf = (node: Node | undefined): string | undefined => {
  if (node?.type === 'Identifier') return node.name as string;
  if (node?.type === 'Literal' && typeof node.value === 'string')
    return node.value;
  return undefined;
};

export const stringLiteral = (node: Node | undefined): string | undefined =>
  node?.type === 'Literal' && typeof node.value === 'string'
    ? node.value
    : undefined;

/** Every node below `node`, depth first. */
export function* walk(node: unknown): Generator<Node> {
  if (Array.isArray(node)) {
    for (const item of node) yield* walk(item);
  } else if (isNode(node)) {
    yield node;
    for (const key in node) {
      if (key !== 'parent') yield* walk(node[key]);
    }
  }
}

export const put = <T extends object, K extends keyof T>(
  target: T,
  key: K,
  value: T[K] | undefined
) => {
  if (value !== undefined) target[key] = value;
};

/** The callee name of a decorator: `customElement` for `@customElement('x')`. */
export const decoratorCall = (
  decorator: Node
): {name: string | undefined; args: Node[]} => {
  const expression = child(decorator, 'expression');
  if (expression?.type === 'CallExpression') {
    return {
      name: nameOf(child(expression, 'callee')),
      args: nodes(expression.arguments),
    };
  }
  return {name: nameOf(expression), args: []};
};

export const findDecorator = (node: Node, name: string) =>
  nodes(node.decorators)
    .map(decoratorCall)
    .find((call) => call.name === name);

/** Where a declaration's leading doc comment would end: before decorators and `export`. */
const leadingStart = (node: Node, wrapper?: Node): number =>
  Math.min(
    node.start,
    wrapper?.start ?? node.start,
    ...nodes(node.decorators).map((d) => d.start)
  );

/** The doc comment above a declaration, also tolerated between its decorators and it. */
export const docOf = (
  code: string,
  node: Node,
  wrapper?: Node
): JsDoc | undefined => {
  const above = jsDocBefore(code, leadingStart(node, wrapper));
  if (above !== undefined) return above;
  const decorators = nodes(node.decorators);
  const last = decorators[decorators.length - 1];
  return last === undefined ? undefined : jsDocAfter(code, last.end);
};
