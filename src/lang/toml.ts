/**
 * A TOML parser for agent config files (`.codex/config.toml`, Gemini command
 * files, and similar) that keeps line numbers. It covers what those files use:
 * tables, arrays of tables, dotted and quoted keys, basic and literal strings
 * (single and multi-line), integers, floats, booleans, dates and times (kept
 * as strings), arrays, and inline tables (including the multi-line inline
 * tables of TOML 1.1).
 *
 * It never throws. On invalid input it records an error with its line, skips
 * to the next line, and keeps going, so the result holds everything that could
 * be parsed.
 */

export type TomlValue = string | number | boolean | TomlValue[] | TomlTable;
export interface TomlTable {
  [key: string]: TomlValue;
}

export interface TomlError {
  line: number;
  message: string;
}

export type TomlPath = ReadonlyArray<string | number>;

export interface TomlDocument {
  data: TomlTable;
  errors: TomlError[];
  /** 1-based line of the key (for values) or of the header (for tables) at a path; array items by index. */
  lineOf(path: TomlPath): number | null;
}

const MAX_TOML = 2 * 1024 * 1024;

export function parseToml(text: string): TomlDocument {
  const parser = new TomlParser(text.length > MAX_TOML ? '' : text);
  if (text.length > MAX_TOML) parser.errors.push({ line: 1, message: 'file too large' });
  else parser.run();
  const lines = parser.lines;
  return {
    data: parser.root,
    errors: parser.errors,
    lineOf: (path) => lines.get(pathKey(path)) ?? null,
  };
}

function pathKey(path: TomlPath): string {
  return JSON.stringify(path);
}

function newTable(): TomlTable {
  return Object.create(null) as TomlTable;
}

function isTable(value: unknown): value is TomlTable {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

class ParseError extends Error {
  readonly line: number;
  constructor(message: string, line: number) {
    super(message);
    this.line = line;
  }
}

const BARE_KEY = /[A-Za-z0-9_-]/;

class TomlParser {
  readonly root: TomlTable = newTable();
  readonly errors: TomlError[] = [];
  readonly lines = new Map<string, number>();
  private readonly src: string;
  private pos = 0;
  private readonly lineStarts: number[];
  private current: TomlTable;
  private currentPath: Array<string | number> = [];
  /** Tables defined with a [header], to report duplicates. */
  private readonly defined = new Set<TomlTable>();
  /** Tables created by an array-of-tables header. */
  private readonly arrayTables = new Set<TomlValue[]>();
  /** Inline tables and arrays, which later statements must not extend. */
  private readonly frozen = new Set<unknown>();

  constructor(src: string) {
    this.src = src.replace(/^\uFEFF/, '');
    this.current = this.root;
    this.lineStarts = [0];
    for (let i = 0; i < this.src.length; i++) if (this.src.charCodeAt(i) === 10) this.lineStarts.push(i + 1);
  }

  lineAt(offset: number): number {
    let lo = 0;
    let hi = this.lineStarts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if ((this.lineStarts[mid] as number) <= offset) lo = mid;
      else hi = mid - 1;
    }
    return lo + 1;
  }

  private fail(message: string, at = this.pos): never {
    throw new ParseError(message, this.lineAt(at));
  }

  run(): void {
    let guard = 0;
    while (this.pos < this.src.length && guard++ < 1_000_000) {
      this.skipWhitespaceAndComments(true);
      if (this.pos >= this.src.length) break;
      const start = this.pos;
      try {
        if (this.src[this.pos] === '[') this.parseHeader();
        else this.parseKeyValue(this.current, this.currentPath);
        this.expectLineEnd();
      } catch (error) {
        if (error instanceof ParseError) this.errors.push({ line: error.line, message: error.message });
        else this.errors.push({ line: this.lineAt(start), message: `internal error: ${(error as Error).message}` });
        this.skipToNextLine(Math.max(this.pos, start));
      }
    }
  }

  private skipToNextLine(from: number): void {
    const nl = this.src.indexOf('\n', from);
    this.pos = nl === -1 ? this.src.length : nl + 1;
  }

  private skipSpaces(): void {
    while (this.pos < this.src.length && (this.src[this.pos] === ' ' || this.src[this.pos] === '\t')) this.pos++;
  }

  /** Spaces, tabs, comments, and (when allowed) newlines. */
  private skipWhitespaceAndComments(newlines: boolean): void {
    while (this.pos < this.src.length) {
      const c = this.src[this.pos];
      if (c === ' ' || c === '\t') this.pos++;
      else if (c === '#') {
        const nl = this.src.indexOf('\n', this.pos);
        this.pos = nl === -1 ? this.src.length : nl;
      } else if (newlines && (c === '\n' || (c === '\r' && this.src[this.pos + 1] === '\n'))) this.pos += c === '\r' ? 2 : 1;
      else break;
    }
  }

  private expectLineEnd(): void {
    this.skipSpaces();
    const c = this.src[this.pos];
    if (c === undefined) return;
    if (c === '#') {
      const nl = this.src.indexOf('\n', this.pos);
      this.pos = nl === -1 ? this.src.length : nl + 1;
      return;
    }
    if (c === '\n') {
      this.pos++;
      return;
    }
    if (c === '\r' && this.src[this.pos + 1] === '\n') {
      this.pos += 2;
      return;
    }
    this.fail(`unexpected text after the value: "${this.src.slice(this.pos, this.pos + 20).split('\n')[0]}"`);
  }

  // -------------------------------------------------------------------------
  // Headers

  private parseHeader(): void {
    const start = this.pos;
    const isArray = this.src[this.pos + 1] === '[';
    this.pos += isArray ? 2 : 1;
    this.skipSpaces();
    const keys = this.parseKey();
    this.skipSpaces();
    if (isArray) {
      if (!this.src.startsWith(']]', this.pos)) this.fail('expected ]] to close the table array header');
      this.pos += 2;
    } else {
      if (this.src[this.pos] !== ']') this.fail('expected ] to close the table header');
      this.pos++;
    }
    const line = this.lineAt(start);
    // Walk to the parent of the last key, creating implicit tables.
    let table = this.root;
    const path: Array<string | number> = [];
    for (let i = 0; i < keys.length - 1; i++) {
      const key = keys[i] as string;
      path.push(key);
      const existing = table[key];
      if (existing === undefined) {
        const t = newTable();
        table[key] = t;
        table = t;
        if (!this.lines.has(pathKey(path))) this.lines.set(pathKey(path), line);
      } else if (Array.isArray(existing) && this.arrayTables.has(existing)) {
        const last = existing[existing.length - 1];
        if (!isTable(last)) this.fail(`"${key}" is not a table`, start);
        path.push(existing.length - 1);
        table = last;
      } else if (isTable(existing) && !this.frozen.has(existing)) {
        table = existing;
      } else {
        this.fail(`"${key}" is already defined as a value`, start);
      }
    }
    const lastKey = keys[keys.length - 1] as string;
    path.push(lastKey);
    const existing = table[lastKey];
    if (isArray) {
      let arr: TomlValue[];
      if (existing === undefined) {
        arr = [];
        table[lastKey] = arr;
        this.arrayTables.add(arr);
        this.lines.set(pathKey(path), line);
      } else if (Array.isArray(existing) && this.arrayTables.has(existing)) {
        arr = existing;
      } else {
        this.fail(`"${keys.join('.')}" is already defined and is not an array of tables`, start);
      }
      const t = newTable();
      arr.push(t);
      path.push(arr.length - 1);
      this.lines.set(pathKey(path), line);
      this.current = t;
      this.currentPath = path;
      return;
    }
    if (existing === undefined) {
      const t = newTable();
      table[lastKey] = t;
      this.defined.add(t);
      this.lines.set(pathKey(path), line);
      this.current = t;
    } else if (isTable(existing) && !this.frozen.has(existing)) {
      if (this.defined.has(existing)) this.fail(`table [${keys.join('.')}] is defined twice`, start);
      this.defined.add(existing);
      this.lines.set(pathKey(path), line);
      this.current = existing;
    } else {
      this.fail(`"${keys.join('.')}" is already defined as a value`, start);
    }
    this.currentPath = path;
  }

  // -------------------------------------------------------------------------
  // Keys and values

  private parseKey(): string[] {
    const keys: string[] = [];
    while (true) {
      this.skipSpaces();
      const c = this.src[this.pos];
      if (c === '"') keys.push(this.parseBasicString());
      else if (c === "'") keys.push(this.parseLiteralString());
      else {
        const start = this.pos;
        while (this.pos < this.src.length && BARE_KEY.test(this.src[this.pos] as string)) this.pos++;
        if (this.pos === start) this.fail('expected a key');
        keys.push(this.src.slice(start, this.pos));
      }
      this.skipSpaces();
      if (this.src[this.pos] === '.') {
        this.pos++;
        continue;
      }
      return keys;
    }
  }

  private parseKeyValue(target: TomlTable, basePath: ReadonlyArray<string | number>): void {
    const keyStart = this.pos;
    const keys = this.parseKey();
    this.skipSpaces();
    if (this.src[this.pos] !== '=') this.fail(`expected = after the key "${keys.join('.')}"`);
    this.pos++;
    this.skipSpaces();
    const line = this.lineAt(keyStart);
    let table = target;
    const path: Array<string | number> = [...basePath];
    for (let i = 0; i < keys.length - 1; i++) {
      const key = keys[i] as string;
      path.push(key);
      const existing = table[key];
      if (existing === undefined) {
        const t = newTable();
        table[key] = t;
        table = t;
        if (!this.lines.has(pathKey(path))) this.lines.set(pathKey(path), line);
      } else if (isTable(existing) && !this.frozen.has(existing) && !this.defined.has(existing)) {
        table = existing;
      } else {
        this.fail(`"${keys.slice(0, i + 1).join('.')}" is already defined`, keyStart);
      }
    }
    const lastKey = keys[keys.length - 1] as string;
    path.push(lastKey);
    if (Object.hasOwn(table, lastKey)) this.fail(`duplicate key "${keys.join('.')}"`, keyStart);
    const value = this.parseValue(path);
    table[lastKey] = value;
    this.lines.set(pathKey(path), line);
  }

  private parseValue(path: Array<string | number>): TomlValue {
    const c = this.src[this.pos];
    if (c === undefined || c === '\n' || c === '#') this.fail('expected a value');
    if (c === '"') return this.src.startsWith('"""', this.pos) ? this.parseMultilineBasic() : this.parseBasicString();
    if (c === "'") return this.src.startsWith("'''", this.pos) ? this.parseMultilineLiteral() : this.parseLiteralString();
    if (c === '[') return this.parseArray(path);
    if (c === '{') return this.parseInlineTable(path);
    if (this.src.startsWith('true', this.pos) && !/[\w-]/.test(this.src[this.pos + 4] ?? '')) {
      this.pos += 4;
      return true;
    }
    if (this.src.startsWith('false', this.pos) && !/[\w-]/.test(this.src[this.pos + 5] ?? '')) {
      this.pos += 5;
      return false;
    }
    return this.parseScalar();
  }

  private parseScalar(): string | number {
    const start = this.pos;
    let m = /^[^\s,\]}#]+/.exec(this.src.slice(this.pos, this.pos + 128));
    if (!m) this.fail('expected a value');
    let token = m[0];
    // Date and time separated by a space: 1979-05-27 07:32:00Z
    if (/^\d{4}-\d{2}-\d{2}$/.test(token)) {
      const after = /^ (\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})?)/i.exec(this.src.slice(this.pos + token.length, this.pos + token.length + 40));
      if (after) token += after[0];
    }
    this.pos = start + token.length;
    if (/^\d{4}-\d{2}-\d{2}([Tt ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?([Zz]|[+-]\d{2}:\d{2})?)?$/.test(token)) return token;
    if (/^\d{2}:\d{2}(:\d{2}(\.\d+)?)?$/.test(token)) return token;
    if (/^[+-]?(inf|nan)$/.test(token)) return token.endsWith('nan') ? Number.NaN : token.startsWith('-') ? -Infinity : Infinity;
    if (/^0x[0-9A-Fa-f](_?[0-9A-Fa-f])*$/.test(token)) return Number.parseInt(token.slice(2).replace(/_/g, ''), 16);
    if (/^0o[0-7](_?[0-7])*$/.test(token)) return Number.parseInt(token.slice(2).replace(/_/g, ''), 8);
    if (/^0b[01](_?[01])*$/.test(token)) return Number.parseInt(token.slice(2).replace(/_/g, ''), 2);
    if (/^[+-]?(0|[1-9](_?\d)*)$/.test(token)) return Number(token.replace(/_/g, ''));
    if (/^[+-]?(0|[1-9](_?\d)*)(\.\d(_?\d)*)?([eE][+-]?\d(_?\d)*)?$/.test(token)) return Number(token.replace(/_/g, ''));
    this.fail(`invalid value "${token.slice(0, 40)}"`, start);
  }

  private parseArray(path: Array<string | number>): TomlValue[] {
    this.pos++; // [
    const out: TomlValue[] = [];
    this.frozen.add(out);
    while (true) {
      this.skipWhitespaceAndComments(true);
      if (this.pos >= this.src.length) this.fail('array not closed');
      if (this.src[this.pos] === ']') {
        this.pos++;
        return out;
      }
      const itemPath = [...path, out.length];
      const line = this.lineAt(this.pos);
      out.push(this.parseValue(itemPath));
      this.lines.set(pathKey(itemPath), line);
      this.skipWhitespaceAndComments(true);
      const c = this.src[this.pos];
      if (c === ',') {
        this.pos++;
        continue;
      }
      if (c === ']') {
        this.pos++;
        return out;
      }
      this.fail('expected , or ] in array');
    }
  }

  private parseInlineTable(path: Array<string | number>): TomlTable {
    this.pos++; // {
    const table = newTable();
    this.frozen.add(table);
    while (true) {
      // TOML 1.1 allows newlines and a trailing comma inside inline tables; accept both.
      this.skipWhitespaceAndComments(true);
      if (this.pos >= this.src.length) this.fail('inline table not closed');
      if (this.src[this.pos] === '}') {
        this.pos++;
        return table;
      }
      this.parseKeyValue(table, path);
      this.skipWhitespaceAndComments(true);
      const c = this.src[this.pos];
      if (c === ',') {
        this.pos++;
        continue;
      }
      if (c === '}') {
        this.pos++;
        return table;
      }
      this.fail('expected , or } in inline table');
    }
  }

  // -------------------------------------------------------------------------
  // Strings

  private parseBasicString(): string {
    const start = this.pos;
    this.pos++;
    let out = '';
    while (this.pos < this.src.length) {
      const c = this.src[this.pos] as string;
      if (c === '"') {
        this.pos++;
        return out;
      }
      if (c === '\n') this.fail('string not closed on its line', start);
      if (c === '\\') {
        out += this.parseEscape();
        continue;
      }
      out += c;
      this.pos++;
    }
    this.fail('string not closed', start);
  }

  private parseLiteralString(): string {
    const start = this.pos;
    const end = this.src.indexOf("'", this.pos + 1);
    const nl = this.src.indexOf('\n', this.pos + 1);
    if (end === -1 || (nl !== -1 && nl < end)) this.fail('string not closed on its line', start);
    this.pos = end + 1;
    return this.src.slice(start + 1, end);
  }

  private parseMultilineBasic(): string {
    const start = this.pos;
    this.pos += 3;
    if (this.src[this.pos] === '\n') this.pos++;
    else if (this.src.startsWith('\r\n', this.pos)) this.pos += 2;
    let out = '';
    while (this.pos < this.src.length) {
      if (this.src.startsWith('"""', this.pos)) {
        // Up to two quotes may end the content right before the closing delimiter.
        let extra = 0;
        while (extra < 2 && this.src[this.pos + 3 + extra] === '"') extra++;
        out += '"'.repeat(extra);
        this.pos += 3 + extra;
        return out;
      }
      const c = this.src[this.pos] as string;
      if (c === '\\') {
        // Line-ending backslash: trim the newline and leading whitespace of the next line.
        const rest = /^\\[ \t]*\r?\n[\s]*/.exec(this.src.slice(this.pos, this.pos + 4096));
        if (rest) {
          this.pos += rest[0].length;
          continue;
        }
        out += this.parseEscape();
        continue;
      }
      out += c;
      this.pos++;
    }
    this.fail('multi-line string not closed', start);
  }

  private parseMultilineLiteral(): string {
    const start = this.pos;
    this.pos += 3;
    if (this.src[this.pos] === '\n') this.pos++;
    else if (this.src.startsWith('\r\n', this.pos)) this.pos += 2;
    const end = this.src.indexOf("'''", this.pos);
    if (end === -1) this.fail('multi-line string not closed', start);
    let extra = 0;
    while (extra < 2 && this.src[end + 3 + extra] === "'") extra++;
    const out = this.src.slice(this.pos, end) + "'".repeat(extra);
    this.pos = end + 3 + extra;
    return out;
  }

  private parseEscape(): string {
    const at = this.pos;
    const kind = this.src[this.pos + 1];
    const simple: Record<string, string> = { b: '\b', t: '\t', n: '\n', f: '\f', r: '\r', e: '\u001b', '"': '"', '\\': '\\' };
    if (kind !== undefined && simple[kind] !== undefined) {
      this.pos += 2;
      return simple[kind] as string;
    }
    const hex = kind === 'u' ? 4 : kind === 'U' ? 8 : kind === 'x' ? 2 : 0;
    if (hex > 0) {
      const digits = this.src.slice(this.pos + 2, this.pos + 2 + hex);
      if (!new RegExp(`^[0-9A-Fa-f]{${hex}}$`).test(digits)) this.fail('invalid unicode escape', at);
      const code = Number.parseInt(digits, 16);
      if (code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)) this.fail('invalid unicode escape', at);
      this.pos += 2 + hex;
      return String.fromCodePoint(code);
    }
    this.fail(`invalid escape \\${kind ?? ''}`, at);
  }
}
