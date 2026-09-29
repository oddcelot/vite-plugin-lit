import type {Plugin} from 'vite';
import {parseAst} from 'vite';
import MagicString from 'magic-string';
import {JS_FILE_RE} from './shared.js';

type Node = Record<string, unknown> & {
  type: string;
  start: number;
  end: number;
};

/** One class body that declares at least one private name. */
interface ClassScope {
  /** Private name (without `#`) to the identifier of its symbol constant. */
  names: Map<string, string>;
}

const PRIVATE_KEY_HOLDERS = new Set([
  'PropertyDefinition',
  'MethodDefinition',
  'AccessorProperty',
]);

const isNode = (v: unknown): v is Node =>
  v !== null && typeof v === 'object' && typeof (v as Node).type === 'string';

/** Private names declared directly in a class body. */
const declaredNames = (cls: Node): Node[] => {
  const body = cls.body as {body?: Node[]} | undefined;
  const out: Node[] = [];
  for (const member of body?.body ?? []) {
    if (
      PRIVATE_KEY_HOLDERS.has(member.type) &&
      isNode(member.key) &&
      member.key.type === 'PrivateIdentifier'
    ) {
      out.push(member);
    }
  }
  return out;
};

/**
 * Rewrites native `#private` class members into computed keys backed by
 * `Symbol.for(...)`. The key is stable across re-evaluations of the module,
 * so instances built by an earlier evaluation of a class and methods copied
 * from a later one agree on where private state lives. That is what lets HMR
 * patch a class in place. Returns `null` when there is nothing to rewrite or
 * the module can't be handled safely.
 */
export const rewritePrivateNames = (
  code: string,
  id: string
): {code: string; map: ReturnType<MagicString['generateMap']>} | null => {
  if (!code.includes('#')) {
    return null;
  }
  const [file] = id.split('?', 1);
  let ast: Node;
  try {
    ast = parseAst(code, {sourceType: 'module'}, file) as unknown as Node;
  } catch {
    return null;
  }

  let prefix = '__litPriv';
  while (code.includes(prefix)) {
    prefix += '_';
  }

  const magic = new MagicString(code);
  const decls: string[] = [];
  const classKeyCounts = new Map<string, number>();
  let symbolCount = 0;
  let failed = false;

  const symbolFor = (scope: ClassScope, name: string): string | undefined =>
    scope.names.get(name);

  const resolve = (stack: ClassScope[], name: string): string => {
    for (let i = stack.length - 1; i >= 0; i--) {
      const sym = symbolFor(stack[i], name);
      if (sym !== undefined) {
        return sym;
      }
    }
    failed = true;
    return '';
  };

  const classKeyOf = (cls: Node, hint: string | undefined): string => {
    const cid = cls.id as {name?: string} | null | undefined;
    const base = cid?.name ?? hint ?? 'anonymous';
    const n = classKeyCounts.get(base) ?? 0;
    classKeyCounts.set(base, n + 1);
    return n === 0 ? base : `${base}~${n}`;
  };

  const rewriteMemberAccess = (node: Node, sym: string): void => {
    const prop = node.property as Node;
    // Find the `.` / `?.` token before the property; the object's own end
    // can't be used because a parenthesised object ends before its `)`.
    let i = prop.start - 1;
    while (i >= 0 && /\s/.test(code[i])) {
      i--;
    }
    if (code[i] !== '.') {
      failed = true;
      return;
    }
    const optional = code[i - 1] === '?';
    const from = optional ? i - 1 : i;
    magic.overwrite(from, prop.end, `${optional ? '?.' : ''}[${sym}]`);
  };

  const visit = (
    node: unknown,
    stack: ClassScope[],
    hint: string | undefined
  ): void => {
    if (failed || node === null || typeof node !== 'object') {
      return;
    }
    if (Array.isArray(node)) {
      for (const item of node) {
        visit(item, stack, hint);
      }
      return;
    }
    if (!isNode(node)) {
      return;
    }

    if (node.type === 'ClassDeclaration' || node.type === 'ClassExpression') {
      const members = declaredNames(node);
      const heritage = node.superClass;
      // Decorators are outside the class body's private-name scope.
      visit(node.decorators, stack, undefined);
      visit(heritage, stack, undefined);
      if (members.length === 0) {
        visit(node.body, stack, undefined);
        return;
      }
      const classKey = classKeyOf(node, hint);
      const scope: ClassScope = {names: new Map()};
      for (const member of members) {
        const name = (member.key as unknown as {name: string}).name;
        if (!scope.names.has(name)) {
          const ident = `${prefix}${symbolCount++}`;
          scope.names.set(name, ident);
          decls.push(
            `const ${ident} = Symbol.for(${JSON.stringify(
              `@oddsquad/vite-plugin-lit#private:${file}:${classKey}#${name}`
            )});`
          );
        }
        if ((member.decorators as unknown[] | undefined)?.length) {
          // A decorator directly before a computed key would parse as an
          // index access on the decorator expression.
          failed = true;
          return;
        }
        const key = member.key as Node;
        const sym = scope.names.get(name)!;
        // A computed key at the start of a member can continue the previous
        // member's initializer when that one relied on ASI (`a = 1` + newline
        // + `#b`), so lead with an explicit terminator.
        let lead = '';
        if (member.start === key.start) {
          let j = key.start - 1;
          while (j >= 0 && /\s/.test(code[j])) {
            j--;
          }
          if (code[j] !== '{' && code[j] !== ';') {
            lead = ';';
          }
        }
        magic.overwrite(key.start, key.end, `${lead}[${sym}]`);
      }
      // Members: keys of non-private members and all values live in scope.
      const inner = [...stack, scope];
      const body = node.body as Node;
      for (const member of (body.body as Node[]) ?? []) {
        for (const k in member) {
          if (k === 'parent' || (k === 'key' && isPrivateKey(member))) {
            continue;
          }
          visit(member[k], inner, undefined);
        }
      }
      return;
    }

    if (node.type === 'MemberExpression' && isNode(node.property)) {
      if (node.property.type === 'PrivateIdentifier') {
        const sym = resolve(
          stack,
          (node.property as unknown as {name: string}).name
        );
        if (failed) {
          return;
        }
        rewriteMemberAccess(node, sym);
        visit(node.object, stack, undefined);
        return;
      }
    }

    if (
      node.type === 'BinaryExpression' &&
      isNode(node.left) &&
      node.left.type === 'PrivateIdentifier'
    ) {
      const sym = resolve(stack, (node.left as unknown as {name: string}).name);
      if (failed) {
        return;
      }
      magic.overwrite(node.left.start, node.left.end, sym);
      visit(node.right, stack, undefined);
      return;
    }

    let childHint: string | undefined;
    for (const key in node) {
      if (key === 'parent') {
        continue;
      }
      switch (node.type) {
        case 'VariableDeclarator':
          childHint =
            key === 'init' && isNode(node.id) && node.id.type === 'Identifier'
              ? (node.id as unknown as {name: string}).name
              : undefined;
          break;
        case 'AssignmentExpression':
          childHint =
            key === 'right' &&
            isNode(node.left) &&
            node.left.type === 'Identifier'
              ? (node.left as unknown as {name: string}).name
              : undefined;
          break;
        case 'ExportDefaultDeclaration':
          childHint = 'default';
          break;
        default:
          childHint = undefined;
      }
      visit(node[key], stack, childHint);
    }
  };

  const isPrivateKey = (member: Node): boolean =>
    PRIVATE_KEY_HOLDERS.has(member.type) &&
    isNode(member.key) &&
    member.key.type === 'PrivateIdentifier';

  visit(ast, [], undefined);
  if (failed || decls.length === 0) {
    return null;
  }

  const header = `${decls.join('')}\n`;
  if (code.startsWith('#!')) {
    const nl = code.indexOf('\n');
    if (nl === -1) {
      return null;
    }
    magic.appendLeft(nl + 1, header);
  } else {
    magic.prepend(header);
  }
  return {code: magic.toString(), map: magic.generateMap({hires: 'boundary'})};
};

/**
 * Dev-only transform that swaps native `#private` class members for stable
 * symbol keys so HMR's in-place class patching keeps working. See
 * {@link rewritePrivateNames}. `enabled` is read lazily because options are
 * re-resolved against the loaded env after the plugin array is built.
 */
export const litPrivateFields = (enabled: () => boolean): Plugin => ({
  name: 'lit-private-fields',
  apply: 'serve',
  transform(code, id, options) {
    if (options?.ssr || !enabled()) {
      return null;
    }
    if (id.startsWith('\0') || id.includes('/node_modules/')) {
      return null;
    }
    const [file, query] = id.split('?', 2);
    if (!JS_FILE_RE.test(file) && !query?.includes('html-proxy')) {
      return null;
    }
    return rewritePrivateNames(code, id);
  },
});
