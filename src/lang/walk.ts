import type { Node } from '@babel/types';

/**
 * Generic AST traversal over Babel nodes. Type-only syntax is skipped: rules
 * look at runtime behavior, and skipping types avoids matching identifiers
 * inside type annotations.
 */

const SKIP_KEYS = new Set([
  'loc',
  'start',
  'end',
  'extra',
  'leadingComments',
  'trailingComments',
  'innerComments',
  'comments',
  'tokens',
  'errors',
  'range',
  'typeAnnotation',
  'returnType',
  'typeParameters',
  'superTypeParameters',
  'typeArguments',
  'implements',
  'predicate',
]);

const SKIP_TYPES = new Set([
  'TSInterfaceDeclaration',
  'TSTypeAliasDeclaration',
  'TSDeclareFunction',
  'TSModuleDeclaration',
  'TSEnumDeclaration',
  'DeclareModule',
  'TypeAlias',
  'InterfaceDeclaration',
]);

export interface WalkHandlers {
  enter?(node: Node, parents: readonly Node[]): void | 'skip';
  exit?(node: Node, parents: readonly Node[]): void;
}

const MAX_DEPTH = 1500;

export function walk(root: Node, handlers: WalkHandlers): void {
  const parents: Node[] = [];
  const visit = (node: Node): void => {
    if (SKIP_TYPES.has(node.type)) return;
    if (parents.length > MAX_DEPTH) return;
    const decision = handlers.enter?.(node, parents);
    if (decision !== 'skip') {
      parents.push(node);
      for (const key of Object.keys(node)) {
        if (SKIP_KEYS.has(key)) continue;
        const value = (node as unknown as Record<string, unknown>)[key];
        if (Array.isArray(value)) {
          for (const item of value) if (isNode(item)) visit(item);
        } else if (isNode(value)) {
          visit(value);
        }
      }
      parents.pop();
    }
    handlers.exit?.(node, parents);
  };
  visit(root);
}

export function isNode(value: unknown): value is Node {
  return typeof value === 'object' && value !== null && typeof (value as { type?: unknown }).type === 'string';
}

/** Find all nodes of the given types under a root (not descending into nested functions when `shallow`). */
export function findAll<T extends Node>(root: Node, types: readonly string[], shallow = false): T[] {
  const out: T[] = [];
  walk(root, {
    enter(node) {
      if (node !== root && shallow && isFunctionNode(node)) return 'skip';
      if (types.includes(node.type)) out.push(node as T);
      return undefined;
    },
  });
  return out;
}

export function isFunctionNode(node: Node): boolean {
  return (
    node.type === 'FunctionDeclaration' ||
    node.type === 'FunctionExpression' ||
    node.type === 'ArrowFunctionExpression' ||
    node.type === 'ObjectMethod' ||
    node.type === 'ClassMethod' ||
    node.type === 'ClassPrivateMethod'
  );
}
