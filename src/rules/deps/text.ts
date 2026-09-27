/**
 * Small readers for the files the deps rules need: package.json key lines,
 * and the few settings they read from .yarnrc.yml and pnpm-workspace.yaml.
 * They avoid loading the YAML parser when Ubon starts, which matters in hooks.
 */

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Lines of the keys one level inside the top-level objects of a JSON
 * document: `"dependencies\0react"` to the line of `"react":` in the
 * dependencies block. The first occurrence wins, like JSON.parse keeps the last
 * value but a reader looks at the first.
 */
export function jsonKeyLines(text: string): Map<string, number> {
  const out = new Map<string, number>();
  let depth = 0;
  let line = 1;
  let top: string | null = null;
  let i = 0;
  const readString = (): string => {
    let value = '';
    i++; // opening quote
    while (i < text.length) {
      const ch = text[i] as string;
      if (ch === '\\') {
        value += text.slice(i, i + 2);
        i += 2;
        continue;
      }
      if (ch === '"') {
        i++;
        break;
      }
      if (ch === '\n') line++;
      value += ch;
      i++;
    }
    try {
      return JSON.parse(`"${value}"`) as string;
    } catch {
      return value;
    }
  };
  while (i < text.length) {
    const ch = text[i] as string;
    if (ch === '\n') {
      line++;
      i++;
    } else if (ch === '"') {
      const startLine = line;
      const value = readString();
      let j = i;
      while (j < text.length && /\s/.test(text[j] as string)) j++;
      if (text[j] !== ':') continue; // a value, not a key
      if (depth === 1) top = value;
      else if (depth === 2 && top !== null) {
        const key = `${top}\0${value}`;
        if (!out.has(key)) out.set(key, startLine);
      }
    } else if (ch === '{' || ch === '[') {
      depth++;
      i++;
    } else if (ch === '}' || ch === ']') {
      depth--;
      if (depth === 1) top = null;
      i++;
    } else {
      i++;
    }
  }
  return out;
}

function unquote(value: string): string {
  const v = value.trim().replace(/\s+#.*$/, '');
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) return v.slice(1, -1);
  return v;
}

/**
 * A top-level YAML list of strings, block (`key:` then `  - item`) or flow
 * (`key: [a, b]`) style. Enough for pnpm-workspace.yaml settings.
 */
export function yamlStringList(text: string, key: string): string[] | null {
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const m = new RegExp(`^${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}:\\s*(.*)$`).exec(lines[i] as string);
    if (!m) continue;
    const rest = (m[1] ?? '').replace(/\s+#.*$/, '').trim();
    if (rest.startsWith('[')) {
      return rest
        .replace(/^\[|\]$/g, '')
        .split(',')
        .map(unquote)
        .filter(Boolean);
    }
    const items: string[] = [];
    for (let j = i + 1; j < lines.length; j++) {
      const l = lines[j] as string;
      if (!l.trim() || l.trim().startsWith('#')) continue;
      const item = /^\s+-\s+(.+)$/.exec(l);
      if (!item) break;
      items.push(unquote(item[1] as string));
    }
    return items;
  }
  return null;
}

/** Yarn 2+ registry settings: npmRegistryServer and npmScopes.<scope>.npmRegistryServer. */
export function yarnRegistrySettings(text: string): { registry?: string; scopes: Map<string, string> } {
  const out: { registry?: string; scopes: Map<string, string> } = { scopes: new Map() };
  let inScopes = false;
  let scope: string | null = null;
  for (const raw of text.split(/\r?\n/)) {
    if (!raw.trim() || raw.trim().startsWith('#')) continue;
    const indent = raw.length - raw.trimStart().length;
    const m = /^\s*("?[^":]+"?)\s*:\s*(.*)$/.exec(raw);
    if (!m) continue;
    const key = unquote(m[1] as string);
    const value = (m[2] ?? '').trim();
    if (indent === 0) {
      inScopes = key === 'npmScopes';
      scope = null;
      if (key === 'npmRegistryServer' && value) out.registry = unquote(value);
    } else if (inScopes && !value) {
      scope = key.replace(/^@/, '');
    } else if (inScopes && scope && key === 'npmRegistryServer' && value) {
      out.scopes.set(`@${scope.toLowerCase()}`, unquote(value));
    }
  }
  return out;
}
