import { LineCounter, type Node as YamlNode, isMap, isPair, isScalar, isSeq, parseDocument } from 'yaml';
import { maskComments } from './comments.ts';

/**
 * JSON, JSONC, and YAML with line numbers. JSON is parsed as YAML (a JSON
 * document is valid YAML 1.2), after masking // and /* comments, so one code
 * path gives values and positions for .mcp.json, settings files, workflows,
 * and compose files. Use JSON.parse directly for large files such as lockfiles.
 */

export type PathKey = string | number;

export interface Structured {
  /** Parsed value, or undefined when the document could not be parsed. */
  data: unknown;
  errors: string[];
  /** 1-based line of the key (for map entries) or the item (for sequences) at a path, or null. */
  lineOf(path: readonly PathKey[]): number | null;
  /** 1-based line of the value at a path (differs from lineOf for multi-line values). */
  valueLineOf(path: readonly PathKey[]): number | null;
}

const MAX_STRUCTURED = 2 * 1024 * 1024;

export function parseStructured(text: string, kind: 'json' | 'yaml'): Structured {
  const lineCounter = new LineCounter();
  if (text.length > MAX_STRUCTURED) return { data: undefined, errors: ['file too large'], lineOf: () => null, valueLineOf: () => null };
  const source = kind === 'json' ? maskComments(text, 'c') : text;
  let doc;
  try {
    doc = parseDocument(source, { lineCounter, uniqueKeys: false, prettyErrors: false, strict: false });
  } catch (error) {
    return { data: undefined, errors: [(error as Error).message], lineOf: () => null, valueLineOf: () => null };
  }
  const errors = doc.errors.map((e) => e.message);
  let data: unknown;
  try {
    data = doc.toJS({ maxAliasCount: 100 });
  } catch (error) {
    errors.push((error as Error).message);
  }
  const lineAt = (offset: number | undefined) => (offset === undefined ? null : lineCounter.linePos(offset).line);
  const locate = (path: readonly PathKey[], wantValue: boolean): number | null => {
    let node: unknown = doc.contents;
    for (let i = 0; i < path.length; i++) {
      const key = path[i] as PathKey;
      const last = i === path.length - 1;
      if (isMap(node)) {
        const pair = node.items.find((p) => isPair(p) && isScalar(p.key) && String(p.key.value) === String(key));
        if (!pair) return null;
        if (last) {
          const target = wantValue && pair.value ? (pair.value as YamlNode) : (pair.key as YamlNode);
          return lineAt(target.range?.[0]);
        }
        node = pair.value;
      } else if (isSeq(node) && typeof key === 'number') {
        const item = node.items[key] as YamlNode | undefined;
        if (!item) return null;
        if (last) return lineAt(item.range?.[0]);
        node = item;
      } else {
        return null;
      }
    }
    return lineAt((node as YamlNode | null)?.range?.[0]);
  };
  return { data, errors, lineOf: (path) => locate(path, false), valueLineOf: (path) => locate(path, true) };
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
