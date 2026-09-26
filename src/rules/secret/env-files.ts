import { findProviderKeys } from './provider-key.ts';
import { isEnvFileName, isLocalConnectionUrl, isPlaceholderValue, isSecretName } from './names.ts';
import type { Rule } from '../types.ts';

export interface EnvEntry {
  line: number;
  name: string;
  value: string;
}

export function parseEnvEntries(text: string): EnvEntry[] {
  const out: EnvEntry[] = [];
  text.split('\n').forEach((raw, i) => {
    const line = raw.replace(/\r$/, '');
    const m = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_.-]*)\s*=\s*(.*)$/.exec(line);
    if (!m) return;
    let value = (m[2] ?? '').trim();
    if (/^["']/.test(value)) {
      const q = value[0] as string;
      const end = value.indexOf(q, 1);
      value = end > 0 ? value.slice(1, end) : value.slice(1);
    } else {
      value = value.replace(/\s+#.*$/, '');
    }
    out.push({ line: i + 1, name: m[1] as string, value });
  });
  return out;
}

export const envFileCommitted: Rule = {
  meta: {
    id: 'secret/env-file-committed',
    level: 'block',
    scope: 'project',
    title: '.env file with secrets that git can commit',
    summary: 'A `.env`, `.env.local`, `.env.production` (or similar) file that is tracked by git, or not ignored by it, and holds real secret values.',
    why: 'An env file in the repository shares every secret in it with everyone who can read the code, and git keeps it in history. Agents often create `.env` files and commit everything with `git add -A`.',
    fix: 'Add the file to .gitignore, remove it from git with `git rm --cached <file>`, commit a `.env.example` with empty values instead, and rotate the secrets it held.',
    cwe: ['CWE-798', 'CWE-538'],
    owasp: ['A07:2025'],
  },
  project(ctx) {
    if (ctx.tracked === null) return; // outside git there is no way to know what gets committed
    for (const view of ctx.scopeFiles) {
      if (view.status === 'deleted' || !isEnvFileName(view.path)) continue;
      const text = ctx.read(view.path);
      if (!text) continue;
      const secrets: EnvEntry[] = [];
      const keyLines = new Set(findProviderKeys(text).map((m) => text.slice(0, m.index).split('\n').length));
      for (const entry of parseEnvEntries(text)) {
        if (keyLines.has(entry.line)) {
          secrets.push(entry);
          continue;
        }
        if (!entry.value || isPlaceholderValue(entry.value)) continue;
        if (!isSecretName(entry.name)) continue;
        if (/:\/\//.test(entry.value) && (!/:\/\/[^/\s:@]*:[^@\s]+@/.test(entry.value) || isLocalConnectionUrl(entry.value))) continue; // URLs without a password, or local ones
        secrets.push(entry);
      }
      if (secrets.length === 0) continue;
      const first = secrets[0] as EnvEntry;
      const state = ctx.tracked.has(view.path) ? 'is tracked by git' : 'is not ignored by git, so `git add` will commit it';
      const names = secrets.slice(0, 4).map((s) => s.name).join(', ') + (secrets.length > 4 ? ', ...' : '');
      ctx.report(view.path, {
        line: first.line,
        message: `${view.path} ${state} and holds ${secrets.length === 1 ? 'a secret' : `${secrets.length} secrets`} (${names}).`,
        evidence: `${first.name}=****`,
      });
    }
  },
};
