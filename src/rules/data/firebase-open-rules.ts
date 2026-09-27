import { maskComments } from '../../lang/comments.ts';
import { isRecord, parseStructured } from '../../lang/structured.ts';
import { lineStarts, offsetToPosition } from '../../core/files.ts';
import type { FileInfo, Rule, TextContext } from '../types.ts';

/**
 * Firebase security rules that let anyone in: `allow read, write: if true`,
 * the console's test-mode rule `if request.time < timestamp.date(...)`, and
 * Realtime Database rules with ".write": true. Parsed with a small scanner
 * that tracks `match` blocks, so a public read of one collection (warn) is
 * told apart from a public read of the whole database (block).
 */

const RULES_FILE = /(^|\/)(firestore|storage)(\.[\w-]+)?\.rules$/;
const RTDB_FILE = /(^|\/)database(\.[\w-]+)?\.rules\.json$/;

const WRITE_METHODS = new Set(['write', 'create', 'update', 'delete']);
const READ_METHODS = new Set(['read', 'get', 'list']);

type Service = 'firestore' | 'storage';

interface AllowStatement {
  methods: string[];
  /** null: `allow read;` with no condition, which always allows. */
  condition: string | null;
  offset: number;
  /** The match paths around the statement, outermost first. */
  path: string[];
  service: Service;
}

/** Find every `allow` statement with its enclosing `match` paths. */
export function scanFirebaseRules(text: string, fallback: Service): AllowStatement[] {
  const src = maskComments(text, 'c');
  const out: AllowStatement[] = [];
  const stack: Array<{ kind: 'service' | 'match' | 'block'; value: string }> = [];
  // A path segment's brace is followed by a name ({userId}, {doc=**}); the block's brace is not.
  const re = /\bservice\s+([\w.]+)\s*\{|\bmatch\s+(\/\S*?)\s*\{(?![\w=*])|\bfunction\s+[\w]+\s*\([^)]*\)\s*\{|\ballow\s+([a-z][a-z\s,]*?)\s*(:\s*if\b|;|(?=\}))|'(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"|[{}]/g;
  let m: RegExpExecArray | null;
  const serviceOf = (): Service => {
    const s = stack.find((f) => f.kind === 'service')?.value ?? '';
    if (/firestore/.test(s)) return 'firestore';
    if (/storage/.test(s)) return 'storage';
    return fallback;
  };
  while ((m = re.exec(src))) {
    const token = m[0];
    if (m[1] !== undefined) stack.push({ kind: 'service', value: m[1] });
    else if (m[2] !== undefined) stack.push({ kind: 'match', value: m[2] });
    else if (token.startsWith('function')) {
      // Skip the function body; it holds no allow statements.
      let depth = 1;
      let i = re.lastIndex;
      while (i < src.length && depth > 0) {
        const ch = src[i];
        if (ch === "'" || ch === '"') {
          const end = src.indexOf(ch, i + 1);
          i = end === -1 ? src.length : end + 1;
          continue;
        }
        if (ch === '{') depth++;
        else if (ch === '}') depth--;
        i++;
      }
      re.lastIndex = i;
    } else if (m[3] !== undefined) {
      const methods = m[3]
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      let condition: string | null = null;
      if (m[4]?.startsWith(':')) {
        const read = readCondition(src, re.lastIndex);
        condition = read.condition;
        re.lastIndex = read.end;
      }
      out.push({
        methods,
        condition,
        offset: m.index,
        path: stack.filter((f) => f.kind === 'match').map((f) => f.value),
        service: serviceOf(),
      });
    } else if (token === '{') stack.push({ kind: 'block', value: '' });
    else if (token === '}') stack.pop();
  }
  return out;
}

/** Read a condition up to `;`, or up to a `}` or a new statement at depth 0. */
function readCondition(src: string, from: number): { condition: string; end: number } {
  let depth = 0;
  let i = from;
  while (i < src.length) {
    const ch = src[i] as string;
    if (ch === "'" || ch === '"') {
      const end = src.indexOf(ch, i + 1);
      i = end === -1 ? src.length : end + 1;
      continue;
    }
    if (ch === '(' || ch === '[' || ch === '{') depth++;
    else if (ch === ')' || ch === ']') depth--;
    else if (ch === '}') {
      if (depth === 0) break;
      depth--;
    } else if (ch === ';' && depth === 0) return { condition: src.slice(from, i).trim(), end: i + 1 };
    else if (ch === '\n' && depth === 0 && /^\s*(allow|match|function)\b/.test(src.slice(i + 1, i + 40))) break;
    i++;
  }
  return { condition: src.slice(from, i).trim(), end: i };
}

type Openness = 'open' | 'test-mode' | 'signed-in' | 'closed';

function stripOuterParens(s: string): string {
  let out = s.trim();
  while (out.startsWith('(') && out.endsWith(')')) {
    let depth = 0;
    let wraps = true;
    for (let i = 0; i < out.length; i++) {
      if (out[i] === '(') depth++;
      else if (out[i] === ')') {
        depth--;
        if (depth === 0 && i !== out.length - 1) {
          wraps = false;
          break;
        }
      }
    }
    if (!wraps) break;
    out = out.slice(1, -1).trim();
  }
  return out;
}

function splitTop(s: string, op: '||' | '&&'): string[] {
  const out: string[] = [];
  let depth = 0;
  let last = 0;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === '(' || ch === '[') depth++;
    else if (ch === ')' || ch === ']') depth--;
    else if (depth === 0 && s.startsWith(op, i)) {
      out.push(s.slice(last, i));
      last = i + 2;
      i++;
    }
  }
  out.push(s.slice(last));
  return out;
}

const RANK: Record<Openness, number> = { closed: 0, 'signed-in': 1, 'test-mode': 2, open: 3 };

export function conditionOpenness(condition: string | null): Openness {
  if (condition === null) return 'open';
  const c = stripOuterParens(condition.replace(/\s+/g, ' '));
  const ors = splitTop(c, '||');
  if (ors.length > 1) return ors.map(conditionOpenness).reduce((a, b) => (RANK[a] >= RANK[b] ? a : b));
  const ands = splitTop(c, '&&');
  if (ands.length > 1) return ands.map(conditionOpenness).reduce((a, b) => (RANK[a] <= RANK[b] ? a : b));
  if (c === 'true') return 'open';
  if (/^request\.time < timestamp\.date\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*\)$/.test(c)) return 'test-mode';
  if (/^request\.auth(?:\.uid)? != null$|^null != request\.auth(?:\.uid)?$/.test(c)) return 'signed-in';
  return 'closed';
}

/** The path below the service prefix (/databases/{db}/documents or /b/{bucket}/o). */
function relativePath(path: string[]): string {
  const full = path.join('').replace(/\/+/g, '/');
  return full.replace(/^\/databases\/\{[^}]+\}\/documents/, '').replace(/^\/b\/\{[^}]+\}\/o/, '') || '/';
}

function isWholeDatabase(path: string[]): boolean {
  return /^\/\{[\w-]+=\*\*\}$/.test(relativePath(path));
}

function checkRulesFile(ctx: TextContext, example: boolean): void {
  const fallback: Service = /storage[^/]*\.rules$/.test(ctx.file.path) ? 'storage' : 'firestore';
  if (!/\ballow\b/.test(ctx.text)) return;
  const starts = lineStarts(ctx.text);
  const file = ctx.file.path.slice(ctx.file.path.lastIndexOf('/') + 1);
  for (const stmt of scanFirebaseRules(ctx.text, fallback)) {
    const open = conditionOpenness(stmt.condition);
    if (open === 'closed') continue;
    const writes = stmt.methods.filter((m) => WRITE_METHODS.has(m));
    const reads = stmt.methods.filter((m) => READ_METHODS.has(m));
    const whole = isWholeDatabase(stmt.path);
    const where = relativePath(stmt.path);
    const what = stmt.service === 'storage' ? (whole ? 'every file' : `files under ${where}`) : whole ? 'every document' : `documents under ${where}`;
    const rule = `allow ${stmt.methods.join(', ')}${stmt.condition === null ? '' : `: if ${stmt.condition.replace(/\s+/g, ' ')}`}`;
    let level: 'block' | 'warn' | null = null;
    let message = '';
    if (open === 'signed-in') {
      if (writes.length === 0 || !whole) continue;
      level = 'warn';
      message = `${file} lets any signed-in user ${verbs(writes, reads)} ${what} (${rule}).`;
    } else if (writes.length > 0) {
      const createOnly = writes.every((w) => w === 'create');
      level = createOnly && !whole ? 'warn' : 'block';
      message =
        open === 'test-mode'
          ? `${file} is in test mode (${rule}), so anyone can ${verbs(writes, reads)} ${what} until that date.`
          : `${file} lets anyone ${verbs(writes, reads)} ${what} (${rule}).`;
    } else if (reads.length > 0) {
      level = whole && stmt.service === 'firestore' ? 'block' : 'warn';
      message =
        open === 'test-mode'
          ? `${file} is in test mode (${rule}), so anyone can read ${what} until that date.`
          : `${file} lets anyone read ${what} (${rule})${level === 'warn' ? '; make sure it holds only public data' : ''}.`;
    }
    if (!level) continue;
    const pos = offsetToPosition(starts, stmt.offset);
    ctx.report({
      line: pos.line,
      column: pos.column,
      level: example ? 'warn' : level,
      message,
      fix:
        open === 'signed-in'
          ? 'Limit writes to the owner, for example `allow write: if request.auth != null && request.auth.uid == userId;` under a match on the owner\'s path.'
          : 'Replace the condition with a check on the signed-in user, such as `request.auth != null && request.auth.uid == userId`, and deny everything else.',
      key: `${where}:${stmt.methods.join(',')}`,
    });
  }
}

function isOpenValue(value: unknown): 'open' | 'signed-in' | null {
  if (value === true) return 'open';
  if (typeof value !== 'string') return null;
  const v = stripOuterParens(value.replace(/\s+/g, ' ').trim());
  if (v === 'true') return 'open';
  if (/^auth != null$|^auth !== null$|^null != auth$/.test(v)) return 'signed-in';
  return null;
}

function checkDatabaseRules(ctx: TextContext, example: boolean): void {
  if (!/"\.(read|write)"/.test(ctx.text)) return;
  const parsed = parseStructured(ctx.text, 'json');
  if (!isRecord(parsed.data) || !isRecord(parsed.data.rules)) return;
  const file = ctx.file.path.slice(ctx.file.path.lastIndexOf('/') + 1);
  const visit = (node: Record<string, unknown>, path: string[], depth: number) => {
    if (depth > 32) return;
    const root = path.length === 1;
    const location = root ? 'anywhere in the Realtime Database' : `under /${path.slice(1).join('/')}`;
    const write = isOpenValue(node['.write']);
    if (write) {
      const line = parsed.lineOf([...path, '.write']);
      if (line !== null && (write === 'open' || root)) {
        const level = write === 'open' ? 'block' : 'warn';
        ctx.report({
          line,
          level: example ? 'warn' : level,
          message:
            write === 'open'
              ? `${file} lets anyone write ${location} (".write": ${JSON.stringify(node['.write'])}).`
              : `${file} lets any signed-in user write ${location} (".write": ${JSON.stringify(node['.write'])}).`,
          fix: 'Limit writes to the owner, for example ".write": "auth != null && auth.uid === $uid" under a "$uid" key.',
          key: `${path.join('/')}:.write`,
        });
      }
    }
    const read = isOpenValue(node['.read']);
    if (read === 'open' && root) {
      const line = parsed.lineOf([...path, '.read']);
      if (line !== null) {
        ctx.report({
          line,
          level: 'warn',
          message: `${file} lets anyone read the whole Realtime Database (".read": ${JSON.stringify(node['.read'])}).`,
          fix: 'Remove the root ".read" rule and allow reads per path, for example ".read": "auth != null && auth.uid === $uid" under a "$uid" key.',
          key: `${path.join('/')}:.read`,
        });
      }
    }
    for (const [k, v] of Object.entries(node)) {
      if (k.startsWith('.') || !isRecord(v)) continue;
      visit(v, [...path, k], depth + 1);
    }
  };
  visit(parsed.data.rules, ['rules'], 0);
}

function verbs(writes: string[], reads: string[]): string {
  const w = new Set<string>();
  for (const m of writes) {
    if (m === 'write') ['create', 'update', 'delete'].forEach((x) => w.add(x));
    else w.add(m);
  }
  const words = [...(reads.length > 0 ? ['read'] : []), ...['create', 'update', 'delete'].filter((x) => w.has(x))];
  if (words.length === 4) return 'read and write';
  if (words.length === 3 && !words.includes('read')) return 'write';
  if (words.length <= 1) return words[0] ?? 'write';
  return `${words.slice(0, -1).join(', ')} and ${words[words.length - 1]}`;
}

export const firebaseOpenRules: Rule = {
  meta: {
    id: 'data/firebase-open-rules',
    level: 'block',
    scope: 'file',
    title: 'Firebase rules open to everyone',
    summary:
      'firestore.rules or storage.rules with `allow read, write: if true`, `allow write: if true`, or the test-mode rule `if request.time < timestamp.date(...)`; database.rules.json with ".write": true.',
    why: 'Firebase clients talk to the database directly with a public config, so the rules are the only access control. Open or test-mode rules let anyone read, change, or delete the data.',
    fix: 'Replace the condition with a check on the signed-in user, such as `request.auth != null && request.auth.uid == userId`, and deny everything else.',
    cwe: ['CWE-284', 'CWE-862'],
    owasp: ['A01:2025'],
    levels:
      'block for public writes and for a public read of the whole Firestore database; warn for public reads of a specific path or a whole Storage bucket, public create-only rules on a specific path, writes open to any signed-in user on the whole database, a root ".read": true in database.rules.json, and everything under example and template folders. Rules under test folders are skipped.',
  },
  appliesTo: (file: FileInfo) => (RULES_FILE.test(file.path) || RTDB_FILE.test(file.path)) && !file.generated && !file.contexts.has('test'),
  text(ctx) {
    const example = ctx.file.contexts.has('example');
    if (RTDB_FILE.test(ctx.file.path)) checkDatabaseRules(ctx, example);
    else checkRulesFile(ctx, example);
  },
};
