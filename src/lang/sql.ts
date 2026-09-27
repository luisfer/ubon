import { lineStarts, offsetToPosition } from '../core/files.ts';

/**
 * A small SQL scanner for Postgres migration files (Supabase migrations and
 * declarative schemas). It splits a file into statements while respecting
 * quotes, dollar-quoted bodies ($$ and $tag$), comments (nested block
 * comments included), BEGIN ATOMIC bodies, psql meta-commands, and COPY data,
 * then recognizes the few statement shapes the data rules need: tables,
 * views, row level security, policies, grants, search_path, DO blocks, and
 * functions. It is not a parser: anything it does not recognize is
 * `{ kind: 'other' }`.
 */

// ---------------------------------------------------------------------------
// Tokens

export type SqlTokenType = 'word' | 'ident' | 'string' | 'dollar' | 'number' | 'op' | 'param' | 'meta';

export interface SqlToken {
  type: SqlTokenType;
  /**
   * word: lowercased (unquoted identifiers fold to lower case); ident (a
   * quoted identifier): the exact name; string and dollar: the content
   * without quotes; everything else: the source text.
   */
  value: string;
  /** Offset of the first character, in the text given to the scanner plus its base offset. */
  start: number;
  end: number;
  /** For dollar-quoted strings: offset of the first character of the content. */
  contentStart?: number;
}

const OP_CHARS = new Set(['+', '-', '*', '/', '<', '>', '=', '~', '!', '@', '#', '%', '^', '&', '|', '`', '?']);
const LONG_OPS = ['->>', '#>>', '::', '<=', '>=', '<>', '!=', '->', '#>', '||', '@>', '<@', '&&', '=>', '!~', '~~', '~*'];
const PUNCT = new Set(['(', ')', '[', ']', ',', ';', '.', ':']);
const DOLLAR_TAG = /\$(?:[A-Za-z_\u0080-￿][A-Za-z0-9_\u0080-￿]*)?\$/y;
const NUMBER = /(?:0[xXoObB][0-9A-Fa-f_]+|\d[\d_]*(?:\.[\d_]*)?(?:[eE][+-]?\d+)?|\.\d[\d_]*(?:[eE][+-]?\d+)?)/y;

function isWordStart(code: number): boolean {
  return (code >= 97 && code <= 122) || (code >= 65 && code <= 90) || code === 95 || code >= 128;
}

function isWordChar(code: number): boolean {
  return isWordStart(code) || (code >= 48 && code <= 57) || code === 36;
}

function isSpace(ch: string): boolean {
  return ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r' || ch === '\f' || ch === '\v' || ch === '﻿' || ch === ' ';
}

function atLineStart(text: string, index: number): boolean {
  for (let i = index - 1; i >= 0; i--) {
    const ch = text[i] as string;
    if (ch === '\n') return true;
    if (ch !== ' ' && ch !== '\t') return false;
  }
  return true;
}

/** Offset after a block comment starting at `start` (Postgres block comments nest). */
function skipBlockComment(text: string, start: number): number {
  let depth = 0;
  let i = start;
  while (i < text.length) {
    if (text[i] === '/' && text[i + 1] === '*') {
      depth++;
      i += 2;
    } else if (text[i] === '*' && text[i + 1] === '/') {
      depth--;
      i += 2;
      if (depth === 0) return i;
    } else i++;
  }
  return text.length;
}

function scanQuoted(text: string, start: number, quote: string, backslash: boolean): { end: number; value: string } {
  let i = start + 1;
  let value = '';
  while (i < text.length) {
    const ch = text[i] as string;
    if (backslash && ch === '\\') {
      value += text[i + 1] ?? '';
      i += 2;
      continue;
    }
    if (ch === quote) {
      if (text[i + 1] === quote) {
        value += quote;
        i += 2;
        continue;
      }
      return { end: i + 1, value };
    }
    value += ch;
    i++;
  }
  return { end: text.length, value };
}

/** Incremental tokenizer, so the statement splitter can skip COPY data. */
class Scanner {
  pos = 0;
  readonly text: string;
  readonly base: number;

  constructor(text: string, base: number) {
    this.text = text;
    this.base = base;
  }

  private tok(type: SqlTokenType, value: string, start: number, end: number): SqlToken {
    this.pos = end;
    return { type, value, start: start + this.base, end: end + this.base };
  }

  next(): SqlToken | null {
    const text = this.text;
    const n = text.length;
    while (this.pos < n) {
      const ch = text[this.pos] as string;
      if (isSpace(ch)) {
        this.pos++;
      } else if (ch === '-' && text[this.pos + 1] === '-') {
        const nl = text.indexOf('\n', this.pos);
        this.pos = nl === -1 ? n : nl + 1;
      } else if (ch === '/' && text[this.pos + 1] === '*') {
        this.pos = skipBlockComment(text, this.pos);
      } else break;
    }
    if (this.pos >= n) return null;
    const start = this.pos;
    const ch = text[start] as string;
    const code = text.charCodeAt(start);

    if (ch === '\\' && atLineStart(text, start)) {
      // psql meta-command (\connect, \set, ...): runs to the end of the line.
      const nl = text.indexOf('\n', start);
      const end = nl === -1 ? n : nl;
      return this.tok('meta', text.slice(start, end), start, end);
    }
    if (ch === "'") {
      const s = scanQuoted(text, start, "'", false);
      return this.tok('string', s.value, start, s.end);
    }
    if (ch === '"') {
      const s = scanQuoted(text, start, '"', false);
      return this.tok('ident', s.value, start, s.end);
    }
    if (ch === '$') {
      DOLLAR_TAG.lastIndex = start;
      const m = DOLLAR_TAG.exec(text);
      if (m) {
        const tag = m[0];
        const close = text.indexOf(tag, start + tag.length);
        const contentEnd = close === -1 ? n : close;
        const end = close === -1 ? n : close + tag.length;
        const token = this.tok('dollar', text.slice(start + tag.length, contentEnd), start, end);
        token.contentStart = start + tag.length + this.base;
        return token;
      }
      let i = start + 1;
      while (i < n && /[0-9]/.test(text[i] as string)) i++;
      if (i > start + 1) return this.tok('param', text.slice(start, i), start, i);
      return this.tok('op', '$', start, start + 1);
    }
    if (isWordStart(code)) {
      let i = start + 1;
      while (i < n && isWordChar(text.charCodeAt(i))) i++;
      const word = text.slice(start, i);
      const lower = word.toLowerCase();
      // Prefixed strings: E'...', N'...', B'...', X'...', U&'...' and U&"..."
      if (text[i] === "'" && (lower === 'e' || lower === 'n' || lower === 'b' || lower === 'x')) {
        const s = scanQuoted(text, i, "'", lower === 'e');
        return this.tok('string', s.value, start, s.end);
      }
      if (lower === 'u' && text[i] === '&' && (text[i + 1] === "'" || text[i + 1] === '"')) {
        const q = text[i + 1] as string;
        const s = scanQuoted(text, i + 1, q, false);
        return this.tok(q === "'" ? 'string' : 'ident', s.value, start, s.end);
      }
      return this.tok('word', lower, start, i);
    }
    if ((code >= 48 && code <= 57) || (ch === '.' && /[0-9]/.test(text[start + 1] ?? ''))) {
      NUMBER.lastIndex = start;
      const m = NUMBER.exec(text);
      const end = m ? start + m[0].length : start + 1;
      return this.tok('number', text.slice(start, end), start, end);
    }
    for (const op of LONG_OPS) {
      if (text.startsWith(op, start)) return this.tok('op', op, start, start + op.length);
    }
    if (PUNCT.has(ch) || OP_CHARS.has(ch)) return this.tok('op', ch, start, start + 1);
    // Anything else (stray characters): one character, so the scanner always moves.
    return this.tok('op', ch, start, start + 1);
  }

  /** Skip COPY ... FROM stdin data, which ends with a line holding only `\.`. */
  skipCopyData(): void {
    const re = /^\\\.\s*$/gm;
    re.lastIndex = this.pos;
    const m = re.exec(this.text);
    this.pos = m ? m.index + m[0].length : this.text.length;
  }
}

export function tokenizeSql(text: string, base = 0): SqlToken[] {
  const scanner = new Scanner(text, base);
  const out: SqlToken[] = [];
  let t: SqlToken | null;
  while ((t = scanner.next())) out.push(t);
  return out;
}

// ---------------------------------------------------------------------------
// Statements

export interface SqlStatement {
  tokens: SqlToken[];
  /** Offset of the first token. */
  start: number;
  /** Offset after the last token (the terminating semicolon is not part of the statement). */
  end: number;
  /** 1-based line of the first token. */
  line: number;
}

/**
 * Split SQL text into statements. Semicolons inside strings, quoted
 * identifiers, dollar-quoted bodies, comments, and BEGIN ATOMIC ... END
 * bodies do not end a statement. psql meta-commands end the statement
 * before them and are dropped.
 */
export function splitSqlStatements(text: string): SqlStatement[] {
  return splitWithBase(text, 0, lineStarts(text));
}

function splitWithBase(text: string, base: number, starts: number[]): SqlStatement[] {
  const scanner = new Scanner(text, base);
  const out: SqlStatement[] = [];
  let current: SqlToken[] = [];
  // BEGIN ATOMIC bodies: > 0 while inside one; counts CASE ... END pairs inside.
  let atomic = 0;
  const flush = () => {
    if (current.length === 0) return;
    const first = current[0] as SqlToken;
    const last = current[current.length - 1] as SqlToken;
    out.push({ tokens: current, start: first.start, end: last.end, line: offsetToPosition(starts, first.start).line });
    current = [];
  };
  let t: SqlToken | null;
  while ((t = scanner.next())) {
    if (t.type === 'meta') {
      flush();
      atomic = 0;
      continue;
    }
    if (atomic > 0 && t.type === 'word') {
      if (t.value === 'case') atomic++;
      else if (t.value === 'end') atomic--;
    }
    if (t.type === 'word' && t.value === 'atomic' && atomic === 0) {
      const prev = current[current.length - 1];
      if (prev && prev.type === 'word' && prev.value === 'begin') atomic = 1;
    }
    if (t.type === 'op' && t.value === ';' && atomic === 0) {
      const isCopyFromStdin = isCopyFromStdinStatement(current);
      flush();
      if (isCopyFromStdin) scanner.skipCopyData();
      continue;
    }
    current.push(t);
  }
  flush();
  return out;
}

function isCopyFromStdinStatement(tokens: SqlToken[]): boolean {
  if (tokens[0]?.type !== 'word' || tokens[0].value !== 'copy') return false;
  for (let i = 1; i < tokens.length - 1; i++) {
    const a = tokens[i] as SqlToken;
    const b = tokens[i + 1] as SqlToken;
    if (a.type === 'word' && a.value === 'from' && b.type === 'word' && b.value === 'stdin') return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Names

export interface QualifiedName {
  /** null when the name is not schema-qualified. */
  schema: string | null;
  name: string;
}

/** Display form of an identifier: quoted when Postgres would need quotes. */
export function quoteIdent(name: string): string {
  return /^[a-z_][a-z0-9_$]*$/.test(name) ? name : `"${name.replace(/"/g, '""')}"`;
}

export function formatName(name: QualifiedName, defaultSchema?: string): string {
  const schema = name.schema ?? defaultSchema;
  return schema ? `${quoteIdent(schema)}.${quoteIdent(name.name)}` : quoteIdent(name.name);
}

// ---------------------------------------------------------------------------
// Statement shapes

export type PolicyCommand = 'all' | 'select' | 'insert' | 'update' | 'delete';

export type RelationKind = 'table' | 'view' | 'materialized view' | 'foreign table';

export type AlterAction =
  | { type: 'enable-rls' }
  | { type: 'disable-rls' }
  | { type: 'force-rls' }
  | { type: 'no-force-rls' }
  | { type: 'rename'; to: string }
  | { type: 'set-schema'; schema: string }
  | { type: 'set-options'; options: Record<string, string> }
  | { type: 'reset-options'; names: string[] }
  | { type: 'other' };

export type SqlCommand =
  | {
      kind: 'create-table';
      name: QualifiedName;
      ifNotExists: boolean;
      temporary: boolean;
      unlogged: boolean;
      foreign: boolean;
      partitionOf: QualifiedName | null;
      asQuery: boolean;
    }
  | {
      kind: 'create-view';
      name: QualifiedName;
      materialized: boolean;
      orReplace: boolean;
      temporary: boolean;
      /** WITH (...) options, lowercased; an option without a value is 'true'. */
      options: Record<string, string>;
    }
  | { kind: 'alter-relation'; objectType: RelationKind; name: QualifiedName; actions: AlterAction[] }
  | { kind: 'drop-relation'; objectType: RelationKind; names: QualifiedName[] }
  | { kind: 'drop-schema'; names: string[]; cascade: boolean }
  | { kind: 'rename-schema'; from: string; to: string }
  | {
      kind: 'create-policy';
      name: string;
      table: QualifiedName;
      permissive: boolean;
      command: PolicyCommand;
      /** Roles after TO, lowercased unless quoted; null when there is no TO clause (PUBLIC). */
      roles: string[] | null;
      using: SqlToken[] | null;
      withCheck: SqlToken[] | null;
    }
  | {
      kind: 'alter-policy';
      name: string;
      table: QualifiedName;
      renameTo: string | null;
      roles: string[] | null;
      using: SqlToken[] | null;
      withCheck: SqlToken[] | null;
    }
  | { kind: 'drop-policy'; name: string; table: QualifiedName }
  | {
      kind: 'grant' | 'revoke';
      /** Lowercased privilege names; 'all' for ALL [PRIVILEGES]. Column-level privileges are left out. */
      privileges: string[];
      /** Named tables (ON [TABLE] a, b), or empty when `schemas` is set. */
      tables: QualifiedName[];
      /** ON ALL TABLES IN SCHEMA a, b */
      schemas: string[];
      roles: string[];
    }
  | { kind: 'default-privileges'; action: 'grant' | 'revoke'; schemas: string[]; privileges: string[]; roles: string[] }
  | { kind: 'set-search-path'; schemas: string[] }
  | { kind: 'do'; body: string; bodyStart: number }
  | { kind: 'create-function'; name: QualifiedName; eventTrigger: boolean; body: string | null; bodyStart: number }
  | { kind: 'create-event-trigger'; name: string; functionName: QualifiedName | null }
  | { kind: 'other' };

class Cursor {
  readonly t: readonly SqlToken[];
  i = 0;

  constructor(tokens: readonly SqlToken[], index = 0) {
    this.t = tokens;
    this.i = index;
  }

  get done(): boolean {
    return this.i >= this.t.length;
  }

  peek(k = 0): SqlToken | undefined {
    return this.t[this.i + k];
  }

  /** True when the next tokens are these words (unquoted). */
  is(...words: string[]): boolean {
    for (let k = 0; k < words.length; k++) {
      const tok = this.t[this.i + k];
      if (!tok || tok.type !== 'word' || tok.value !== words[k]) return false;
    }
    return true;
  }

  eat(...words: string[]): boolean {
    if (!this.is(...words)) return false;
    this.i += words.length;
    return true;
  }

  isOp(value: string, k = 0): boolean {
    const tok = this.t[this.i + k];
    return tok !== undefined && tok.type === 'op' && tok.value === value;
  }

  eatOp(value: string): boolean {
    if (!this.isOp(value)) return false;
    this.i++;
    return true;
  }

  /** One identifier: an unquoted word (lowercased) or a quoted identifier (exact). */
  ident(): string | null {
    const tok = this.t[this.i];
    if (!tok || (tok.type !== 'word' && tok.type !== 'ident')) return null;
    this.i++;
    return tok.value;
  }

  name(): QualifiedName | null {
    const parts: string[] = [];
    const first = this.ident();
    if (first === null) return null;
    parts.push(first);
    while (this.isOp('.') && (this.peek(1)?.type === 'word' || this.peek(1)?.type === 'ident')) {
      this.i++;
      parts.push(this.ident() as string);
    }
    const name = parts[parts.length - 1] as string;
    const schema = parts.length >= 2 ? (parts[parts.length - 2] as string) : null;
    return { schema, name };
  }

  /** At '(': the tokens inside the matching parentheses; the cursor moves past ')'. */
  parens(): SqlToken[] | null {
    if (!this.isOp('(')) return null;
    let depth = 0;
    const start = this.i;
    for (let j = this.i; j < this.t.length; j++) {
      const tok = this.t[j] as SqlToken;
      if (tok.type !== 'op') continue;
      if (tok.value === '(' || tok.value === '[') depth++;
      else if (tok.value === ')' || tok.value === ']') {
        depth--;
        if (depth === 0) {
          this.i = j + 1;
          return this.t.slice(start + 1, j);
        }
      }
    }
    this.i = this.t.length;
    return this.t.slice(start + 1);
  }

  /** Comma-separated names until a word in `stop` or the end. */
  nameList(stop: readonly string[] = []): QualifiedName[] {
    const out: QualifiedName[] = [];
    while (!this.done) {
      const tok = this.peek();
      if (tok?.type === 'word' && stop.includes(tok.value)) break;
      const n = this.name();
      if (!n) break;
      out.push(n);
      if (!this.eatOp(',')) break;
    }
    return out;
  }
}

/** Split tokens at top-level commas (outside parentheses and brackets). */
export function splitTopLevel(tokens: readonly SqlToken[], separator = ','): SqlToken[][] {
  const out: SqlToken[][] = [];
  let current: SqlToken[] = [];
  let depth = 0;
  for (const tok of tokens) {
    if (tok.type === 'op') {
      if (tok.value === '(' || tok.value === '[') depth++;
      else if (tok.value === ')' || tok.value === ']') depth--;
      else if (tok.value === separator && depth === 0) {
        out.push(current);
        current = [];
        continue;
      }
    }
    current.push(tok);
  }
  out.push(current);
  return out;
}

function wordsOf(tokens: readonly SqlToken[]): string[] {
  return tokens.map((t) => (t.type === 'word' ? t.value : t.type === 'op' ? t.value : `\u0000${t.value}`));
}

function startsWithWords(tokens: readonly SqlToken[], ...words: string[]): boolean {
  if (tokens.length < words.length) return false;
  return words.every((w, i) => tokens[i]?.type === 'word' && tokens[i]?.value === w);
}

function parseOptions(tokens: readonly SqlToken[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of splitTopLevel(tokens)) {
    const key = part[0];
    if (!key || (key.type !== 'word' && key.type !== 'ident')) continue;
    let name = key.value.toLowerCase();
    let i = 1;
    // Namespaced options: toast.autovacuum_enabled
    while (part[i]?.type === 'op' && part[i]?.value === '.' && part[i + 1]) {
      name += `.${(part[i + 1] as SqlToken).value.toLowerCase()}`;
      i += 2;
    }
    if (part[i]?.type === 'op' && part[i]?.value === '=') {
      const v = part[i + 1];
      out[name] = v ? v.value.toLowerCase() : '';
    } else out[name] = 'true';
  }
  return out;
}

/** Postgres boolean option values. */
export function isTrueOption(value: string | undefined): boolean {
  return value !== undefined && /^(true|on|yes|1|t|y)$/i.test(value.trim());
}

function roleList(c: Cursor, stop: readonly string[]): string[] {
  const roles: string[] = [];
  while (!c.done) {
    const tok = c.peek();
    if (!tok) break;
    if (tok.type === 'word' && stop.includes(tok.value)) break;
    if (tok.type === 'word' && tok.value === 'group') {
      c.i++;
      continue;
    }
    if (tok.type === 'word' || tok.type === 'ident' || tok.type === 'string') {
      roles.push(tok.value);
      c.i++;
    } else if (!(tok.type === 'op' && tok.value === ',')) break;
    else c.i++;
  }
  return roles;
}

const PRIVILEGE_WORDS = new Set(['select', 'insert', 'update', 'delete', 'truncate', 'references', 'trigger', 'all', 'maintain', 'usage', 'execute', 'create', 'connect', 'temporary', 'temp']);

function privilegeList(tokens: readonly SqlToken[]): string[] {
  const out: string[] = [];
  for (const part of splitTopLevel(tokens)) {
    const first = part[0];
    if (!first || first.type !== 'word' || !PRIVILEGE_WORDS.has(first.value)) continue;
    // Column-level privileges (SELECT (a, b)) do not open the table.
    if (part.some((t) => t.type === 'op' && t.value === '(')) continue;
    out.push(first.value);
  }
  return out;
}

/** Recognize one statement. */
export function parseSqlCommand(stmt: { tokens: readonly SqlToken[] }): SqlCommand {
  const c = new Cursor(stmt.tokens);
  try {
    if (c.eat('create')) return parseCreate(c);
    if (c.eat('alter')) return parseAlter(c);
    if (c.eat('drop')) return parseDrop(c);
    if (c.is('grant') || c.is('revoke')) return parseGrant(c);
    if (c.eat('set')) return parseSet(c);
    if (c.is('select') || c.is('perform')) return parseSelectSetConfig(c);
    if (c.eat('do')) {
      const body = stmt.tokens.find((t) => t.type === 'dollar' || t.type === 'string');
      if (body) return { kind: 'do', body: body.value, bodyStart: body.contentStart ?? body.start + 1 };
    }
  } catch {
    return { kind: 'other' };
  }
  return { kind: 'other' };
}

function parseCreate(c: Cursor): SqlCommand {
  const orReplace = c.eat('or', 'replace');
  let temporary = false;
  let unlogged = false;
  if (c.eat('global') || c.eat('local')) temporary = true;
  if (c.eat('temporary') || c.eat('temp')) temporary = true;
  if (c.eat('unlogged')) unlogged = true;
  if (c.eat('foreign', 'table')) return parseCreateTable(c, { temporary, unlogged, foreign: true });
  if (c.eat('table')) return parseCreateTable(c, { temporary, unlogged, foreign: false });
  c.eat('recursive');
  if (c.eat('materialized', 'view')) return parseCreateView(c, { materialized: true, orReplace, temporary });
  if (c.eat('view')) return parseCreateView(c, { materialized: false, orReplace, temporary });
  if (c.eat('policy')) return parseCreatePolicy(c);
  if (c.eat('event', 'trigger')) return parseCreateEventTrigger(c);
  if (c.eat('function') || c.eat('procedure')) return parseCreateFunction(c);
  return { kind: 'other' };
}

function parseCreateTable(c: Cursor, flags: { temporary: boolean; unlogged: boolean; foreign: boolean }): SqlCommand {
  const ifNotExists = c.eat('if', 'not', 'exists');
  const name = c.name();
  if (!name) return { kind: 'other' };
  let partitionOf: QualifiedName | null = null;
  let asQuery = false;
  if (c.eat('partition', 'of')) partitionOf = c.name();
  else if (c.eat('of')) {
    c.name();
  } else {
    if (c.isOp('(')) c.parens();
    if (c.is('as') || c.is('with') || c.is('tablespace') || c.is('using')) {
      // CREATE TABLE ... [USING m] [WITH (...)] [TABLESPACE t] AS query
      for (let guard = 0; guard < 8 && !c.done; guard++) {
        if (c.eat('as')) {
          asQuery = true;
          break;
        }
        if (c.eat('with')) {
          if (c.isOp('(')) c.parens();
        } else if (c.eat('using') || c.eat('tablespace')) c.ident();
        else break;
      }
    }
  }
  return { kind: 'create-table', name, ifNotExists, partitionOf, asQuery, ...flags };
}

function parseCreateView(c: Cursor, flags: { materialized: boolean; orReplace: boolean; temporary: boolean }): SqlCommand {
  c.eat('if', 'not', 'exists');
  const name = c.name();
  if (!name) return { kind: 'other' };
  if (c.isOp('(')) c.parens();
  let options: Record<string, string> = {};
  for (let guard = 0; guard < 6 && !c.done; guard++) {
    if (c.eat('with')) {
      const inner = c.parens();
      if (inner) options = { ...options, ...parseOptions(inner) };
    } else if (c.eat('using') || c.eat('tablespace')) c.ident();
    else break;
  }
  return { kind: 'create-view', name, options, ...flags };
}

function parseCreatePolicy(c: Cursor): SqlCommand {
  // Postgres has no CREATE POLICY IF NOT EXISTS, but agents write it; judge the intended policy.
  c.eat('if', 'not', 'exists');
  const name = c.ident();
  if (name === null || !c.eat('on')) return { kind: 'other' };
  const table = c.name();
  if (!table) return { kind: 'other' };
  let permissive = true;
  let command: PolicyCommand = 'all';
  let roles: string[] | null = null;
  let using: SqlToken[] | null = null;
  let withCheck: SqlToken[] | null = null;
  for (let guard = 0; guard < 10 && !c.done; guard++) {
    if (c.eat('as')) {
      const kind = c.ident();
      if (kind === 'restrictive') permissive = false;
    } else if (c.eat('for')) {
      const cmd = c.ident();
      if (cmd === 'all' || cmd === 'select' || cmd === 'insert' || cmd === 'update' || cmd === 'delete') command = cmd;
    } else if (c.eat('to')) {
      roles = roleList(c, ['using', 'with']);
    } else if (c.eat('using')) {
      using = c.parens();
    } else if (c.eat('with', 'check')) {
      withCheck = c.parens();
    } else break;
  }
  return { kind: 'create-policy', name, table, permissive, command, roles, using, withCheck };
}

function parseCreateEventTrigger(c: Cursor): SqlCommand {
  const name = c.ident() ?? '';
  let functionName: QualifiedName | null = null;
  for (let j = c.i; j < c.t.length; j++) {
    const tok = c.t[j] as SqlToken;
    if (tok.type === 'word' && tok.value === 'execute') {
      const inner = new Cursor(c.t, j + 1);
      if (inner.eat('function') || inner.eat('procedure')) functionName = inner.name();
      break;
    }
  }
  return { kind: 'create-event-trigger', name, functionName };
}

function parseCreateFunction(c: Cursor): SqlCommand {
  const name = c.name();
  if (!name) return { kind: 'other' };
  let eventTrigger = false;
  let body: string | null = null;
  let bodyStart = 0;
  for (let j = c.i; j < c.t.length; j++) {
    const tok = c.t[j] as SqlToken;
    if (tok.type === 'word' && tok.value === 'returns') {
      const next = c.t[j + 1];
      if (next?.type === 'word' && next.value === 'event_trigger') eventTrigger = true;
    }
    if (tok.type === 'word' && tok.value === 'as' && body === null) {
      const next = c.t[j + 1];
      if (next && (next.type === 'dollar' || next.type === 'string')) {
        body = next.value;
        bodyStart = next.contentStart ?? next.start + 1;
      }
    }
  }
  return { kind: 'create-function', name, eventTrigger, body, bodyStart };
}

function relationKind(c: Cursor): RelationKind | null {
  if (c.eat('table')) return 'table';
  if (c.eat('view')) return 'view';
  if (c.eat('materialized', 'view')) return 'materialized view';
  if (c.eat('foreign', 'table')) return 'foreign table';
  return null;
}

function parseAlter(c: Cursor): SqlCommand {
  if (c.eat('policy')) return parseAlterPolicy(c);
  if (c.eat('default', 'privileges')) return parseDefaultPrivileges(c);
  if (c.eat('schema')) {
    const from = c.ident();
    if (from !== null && c.eat('rename', 'to')) {
      const to = c.ident();
      if (to !== null) return { kind: 'rename-schema', from, to };
    }
    return { kind: 'other' };
  }
  const objectType = relationKind(c);
  if (!objectType) return { kind: 'other' };
  if (c.is('all', 'in')) return { kind: 'other' };
  c.eat('if', 'exists');
  c.eat('only');
  const name = c.name();
  if (!name) return { kind: 'other' };
  c.eatOp('*');
  const rest = c.t.slice(c.i);
  const actions: AlterAction[] = splitTopLevel(rest).map(parseAlterAction);
  return { kind: 'alter-relation', objectType, name, actions };
}

function parseAlterAction(tokens: SqlToken[]): AlterAction {
  if (startsWithWords(tokens, 'enable', 'row', 'level', 'security')) return { type: 'enable-rls' };
  if (startsWithWords(tokens, 'disable', 'row', 'level', 'security')) return { type: 'disable-rls' };
  if (startsWithWords(tokens, 'force', 'row', 'level', 'security')) return { type: 'force-rls' };
  if (startsWithWords(tokens, 'no', 'force', 'row', 'level', 'security')) return { type: 'no-force-rls' };
  const c = new Cursor(tokens);
  if (c.eat('rename', 'to')) {
    const to = c.ident();
    return to === null ? { type: 'other' } : { type: 'rename', to };
  }
  if (c.eat('set', 'schema')) {
    const schema = c.ident();
    return schema === null ? { type: 'other' } : { type: 'set-schema', schema };
  }
  if (c.eat('set') && c.isOp('(')) {
    const inner = c.parens() ?? [];
    return { type: 'set-options', options: parseOptions(inner) };
  }
  const r = new Cursor(tokens);
  if (r.eat('reset') && r.isOp('(')) {
    const inner = r.parens() ?? [];
    return { type: 'reset-options', names: Object.keys(parseOptions(inner)) };
  }
  return { type: 'other' };
}

function parseAlterPolicy(c: Cursor): SqlCommand {
  const name = c.ident();
  if (name === null || !c.eat('on')) return { kind: 'other' };
  const table = c.name();
  if (!table) return { kind: 'other' };
  let renameTo: string | null = null;
  let roles: string[] | null = null;
  let using: SqlToken[] | null = null;
  let withCheck: SqlToken[] | null = null;
  if (c.eat('rename', 'to')) renameTo = c.ident();
  for (let guard = 0; guard < 6 && !c.done; guard++) {
    if (c.eat('to')) roles = roleList(c, ['using', 'with']);
    else if (c.eat('using')) using = c.parens();
    else if (c.eat('with', 'check')) withCheck = c.parens();
    else break;
  }
  return { kind: 'alter-policy', name, table, renameTo, roles, using, withCheck };
}

function parseDrop(c: Cursor): SqlCommand {
  if (c.eat('policy')) {
    c.eat('if', 'exists');
    const name = c.ident();
    if (name === null || !c.eat('on')) return { kind: 'other' };
    const table = c.name();
    return table ? { kind: 'drop-policy', name, table } : { kind: 'other' };
  }
  if (c.eat('schema')) {
    c.eat('if', 'exists');
    const names: string[] = [];
    while (!c.done) {
      const n = c.ident();
      if (n === null) break;
      if (n === 'cascade' || n === 'restrict') {
        c.i--;
        break;
      }
      names.push(n);
      if (!c.eatOp(',')) break;
    }
    const cascade = c.t.some((t) => t.type === 'word' && t.value === 'cascade');
    return { kind: 'drop-schema', names, cascade };
  }
  const objectType = relationKind(c);
  if (!objectType) return { kind: 'other' };
  c.eat('if', 'exists');
  const names = c.nameList(['cascade', 'restrict']);
  return { kind: 'drop-relation', objectType, names };
}

function parseGrant(c: Cursor): SqlCommand {
  const action = c.ident() as 'grant' | 'revoke';
  if (action === 'revoke') c.eat('grant', 'option', 'for');
  // Privileges run until ON.
  const privTokens: SqlToken[] = [];
  while (!c.done && !c.is('on')) privTokens.push(c.t[c.i++] as SqlToken);
  if (!c.eat('on')) return { kind: 'other' };
  const privileges = privilegeList(privTokens);
  const tables: QualifiedName[] = [];
  const schemas: string[] = [];
  const target = action === 'grant' ? 'to' : 'from';
  if (c.eat('all', 'tables', 'in', 'schema')) {
    while (!c.done && !c.is(target)) {
      const s = c.ident();
      if (s === null) break;
      schemas.push(s);
      if (!c.eatOp(',')) break;
    }
  } else if (c.is('all') || c.is('sequence') || c.is('sequences') || c.is('function') || c.is('functions') || c.is('schema') || c.is('database') || c.is('procedure') || c.is('routine') || c.is('type') || c.is('domain') || c.is('language') || c.is('large') || c.is('foreign') || c.is('tablespace') || c.is('parameter')) {
    return { kind: 'other' };
  } else {
    c.eat('table');
    tables.push(...c.nameList([target]));
  }
  if (!c.eat(target)) return { kind: 'other' };
  const roles = roleList(c, ['with', 'granted', 'cascade', 'restrict']);
  return { kind: action, privileges, tables, schemas, roles };
}

function parseDefaultPrivileges(c: Cursor): SqlCommand {
  const schemas: string[] = [];
  for (let guard = 0; guard < 4 && !c.done; guard++) {
    if (c.eat('for', 'role') || c.eat('for', 'user')) {
      roleList(c, ['in', 'grant', 'revoke']);
    } else if (c.eat('in', 'schema')) {
      while (!c.done) {
        const s = c.ident();
        if (s === null) break;
        schemas.push(s);
        if (!c.eatOp(',')) break;
      }
    } else break;
  }
  const action = c.ident();
  if (action !== 'grant' && action !== 'revoke') return { kind: 'other' };
  if (action === 'revoke') c.eat('grant', 'option', 'for');
  const privTokens: SqlToken[] = [];
  while (!c.done && !c.is('on')) privTokens.push(c.t[c.i++] as SqlToken);
  if (!c.eat('on') || !c.eat('tables')) return { kind: 'other' };
  const target = action === 'grant' ? 'to' : 'from';
  if (!c.eat(target)) return { kind: 'other' };
  const roles = roleList(c, ['with', 'cascade', 'restrict']);
  return { kind: 'default-privileges', action, schemas, privileges: privilegeList(privTokens), roles };
}

function parseSet(c: Cursor): SqlCommand {
  c.eat('session') || c.eat('local');
  if (!c.eat('search_path')) return { kind: 'other' };
  if (!c.eat('to') && !c.eatOp('=')) return { kind: 'other' };
  const schemas: string[] = [];
  for (const part of splitTopLevel(c.t.slice(c.i))) {
    const tok = part[0];
    if (!tok) continue;
    if (tok.type === 'string') schemas.push(...tok.value.split(',').map((s) => s.trim().replace(/^"|"$/g, '')).filter(Boolean));
    else if (tok.type === 'word' || tok.type === 'ident') schemas.push(tok.value);
  }
  return { kind: 'set-search-path', schemas };
}

/** SELECT pg_catalog.set_config('search_path', '', false), as written by pg_dump. */
function parseSelectSetConfig(c: Cursor): SqlCommand {
  const words = wordsOf(c.t);
  const at = words.indexOf('set_config');
  if (at === -1) return { kind: 'other' };
  const args = c.t.slice(at + 2);
  const first = args[0];
  const second = args[2];
  if (first?.type !== 'string' || first.value !== 'search_path' || second?.type !== 'string') return { kind: 'other' };
  return {
    kind: 'set-search-path',
    schemas: second.value
      .split(',')
      .map((s) => s.trim().replace(/^"|"$/g, ''))
      .filter(Boolean),
  };
}

// ---------------------------------------------------------------------------
// Files: statements, shapes, and statements inside DO blocks and functions

export interface SqlCommandAt {
  command: SqlCommand;
  /** 1-based line of the statement's first token. */
  line: number;
  start: number;
  /**
   * Where the statement sits: 'top' in the file itself, 'do' inside a DO
   * block (runs when the migration runs), 'function' inside a function body
   * (runs only when the function is called).
   */
  context: 'top' | 'do' | 'function';
}

export interface SqlFileScan {
  commands: SqlCommandAt[];
  /**
   * Offsets of `ENABLE ROW LEVEL SECURITY` inside strings that build SQL at
   * run time (EXECUTE format(...), string concatenation), where the table
   * name is not known. `context` says whether it runs at migration time.
   */
  dynamicRls: Array<{ line: number; start: number; context: 'do' | 'function'; functionName?: string }>;
}

const DDL_START = new Set(['create', 'alter', 'drop', 'grant', 'revoke']);
const PLPGSQL_BOUNDARY = new Set(['begin', 'then', 'else', 'loop', 'declare']);
const ENABLE_RLS = /\benable\s+row\s+level\s+security\b/i;

/** Scan a whole SQL file: every statement with its shape, including statements inside DO blocks and functions. */
export function scanSqlFile(text: string): SqlFileScan {
  const starts = lineStarts(text);
  const out: SqlFileScan = { commands: [], dynamicRls: [] };
  for (const stmt of splitWithBase(text, 0, starts)) {
    const command = parseSqlCommand(stmt);
    out.commands.push({ command, line: stmt.line, start: stmt.start, context: 'top' });
    if (command.kind === 'do') scanBody(command.body, command.bodyStart, 'do', undefined, starts, out, 0);
    else if (command.kind === 'create-function' && command.body !== null) {
      scanBody(command.body, command.bodyStart, 'function', formatName(command.name), starts, out, 0);
    }
  }
  return out;
}

function scanBody(body: string, base: number, context: 'do' | 'function', functionName: string | undefined, starts: number[], out: SqlFileScan, depth: number): void {
  if (depth > 2 || body.length === 0) return;
  const tokens = tokenizeSql(body, base);
  const push = (tokensOfStatement: SqlToken[]) => {
    const first = tokensOfStatement[0];
    if (!first) return;
    const command = parseSqlCommand({ tokens: tokensOfStatement });
    if (command.kind === 'other') return;
    out.commands.push({ command, line: offsetToPosition(starts, first.start).line, start: first.start, context });
  };
  // Static statements: split at semicolons, then find where a DDL statement starts after PL/pgSQL keywords.
  let chunk: SqlToken[] = [];
  const flush = () => {
    for (let i = 0; i < chunk.length; i++) {
      const tok = chunk[i] as SqlToken;
      if (tok.type !== 'word' || !DDL_START.has(tok.value)) continue;
      const prev = chunk[i - 1];
      if (i === 0 || (prev?.type === 'word' && PLPGSQL_BOUNDARY.has(prev.value))) {
        push(chunk.slice(i));
        break;
      }
    }
    chunk = [];
  };
  for (const tok of tokens) {
    if (tok.type === 'op' && tok.value === ';') flush();
    else chunk.push(tok);
  }
  flush();
  // SQL inside strings (EXECUTE 'alter table ...', format('...')).
  for (const tok of tokens) {
    if (tok.type !== 'string' && tok.type !== 'dollar') continue;
    const inner = tok.value;
    const innerBase = tok.contentStart ?? tok.start + 1;
    const staticEnables = new Set<number>();
    if (/^\s*(create|alter|drop|grant|revoke)\b/i.test(inner) && !/%[IsL]|\$\d/.test(inner)) {
      for (const stmt of splitWithBase(inner, innerBase, starts)) {
        const command = parseSqlCommand(stmt);
        if (command.kind === 'other') continue;
        out.commands.push({ command, line: stmt.line, start: stmt.start, context });
        if (command.kind === 'alter-relation' && command.actions.some((a) => a.type === 'enable-rls')) staticEnables.add(stmt.start);
      }
    }
    if (ENABLE_RLS.test(inner) && staticEnables.size === 0) {
      const at = innerBase + inner.search(ENABLE_RLS);
      out.dynamicRls.push({ line: offsetToPosition(starts, at).line, start: at, context, ...(functionName ? { functionName } : {}) });
    }
    if (tok.type === 'dollar' && /\b(begin|execute)\b/i.test(inner) && depth < 2) {
      // A nested dollar-quoted block (a function created inside a DO block).
      scanBody(inner, innerBase, context, functionName, starts, { commands: [], dynamicRls: out.dynamicRls }, depth + 1);
    }
  }
}

// ---------------------------------------------------------------------------
// Expressions

const TIGHT_OPS = new Set(['(', ')', '[', ']', '.', ',']);

/**
 * Normalized source text of an expression: lowercased words, casts removed
 * (`'x'::text` reads `'x'`), one space between words and around operators,
 * none inside calls and member access. Used to compare expressions and to
 * quote them in messages.
 */
export function expressionText(tokens: readonly SqlToken[] | null): string {
  if (!tokens) return '';
  let out = '';
  let prev: SqlToken | null = null;
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i] as SqlToken;
    if (t.type === 'op' && t.value === '::') {
      // Drop the cast and its type name (text, uuid, character varying, timestamp with time zone, text[]).
      i++;
      while (i + 1 < tokens.length && tokens[i + 1]?.type === 'word' && /^(varying|precision|zone|time|with|without)$/.test((tokens[i + 1] as SqlToken).value)) i++;
      if (tokens[i + 1]?.type === 'op' && tokens[i + 1]?.value === '[' && tokens[i + 2]?.value === ']') i += 2;
      continue;
    }
    const text = t.type === 'string' ? `'${t.value.replace(/'/g, "''")}'` : t.type === 'ident' ? quoteIdent(t.value) : t.value;
    if (prev) {
      const isOp = t.type === 'op';
      const prevOp = prev.type === 'op';
      let space = true;
      if (prevOp && prev.value === ',') space = true;
      else if (isOp && (t.value === ')' || t.value === ']' || t.value === ',' || t.value === '.' || t.value === '[')) space = false;
      else if (prevOp && (prev.value === '(' || prev.value === '[' || prev.value === '.')) space = false;
      else if (isOp && t.value === '(' && !(prevOp && !TIGHT_OPS.has(prev.value)) && !(prev.type === 'word' && /^(and|or|not|in|exists|any|all|some|select|where|when|then|else|is|between|like|ilike|array)$/.test(prev.value))) space = false;
      if (space) out += ' ';
    }
    out += text;
    prev = t;
  }
  return out;
}
