/**
 * A shell tokenizer for command checks. It splits a command line into simple
 * commands across `|`, `&&`, `||`, `;`, `&`, and newlines, resolves quotes and
 * escapes, and parses nested code: `$(...)` and backtick substitutions,
 * `<(...)` process substitutions, subshells, `bash -c '...'` payloads, `eval`
 * strings, and `find -exec` commands. Wrappers that run another command
 * (`sudo`, `env`, `xargs`, `nohup`, `time`, `command`, `exec`, `timeout`,
 * `npx`, `pnpm dlx`, `bunx`, ...) and leading `VAR=value` assignments are
 * stripped, so `argv` is what actually runs.
 *
 * It is a best-effort parser for checks, not an interpreter: it never throws,
 * never expands variables, and reports what it could not parse in `errors`.
 * A PowerShell dialect covers the forms agents send through PowerShell tools
 * (pipelines, `;`, quotes, backtick escapes, `(...)` and `$(...)` groups).
 */

export type ShellDialect = 'sh' | 'powershell';

export interface Expansion {
  kind: 'var' | 'command' | 'arith' | 'process';
  /** Source text of the expansion, for example `$HOME`, `${DIR:-x}`, `$(pwd)`. */
  text: string;
  /** Variable name for `var` expansions. */
  name?: string;
  quoted: boolean;
  /** Offset of the expansion inside the word's value. */
  at: number;
}

export interface ShellWord {
  /** Source text of the word. */
  raw: string;
  /** Value with quotes removed and escapes resolved. Expansions stay as written. */
  value: string;
  /** Some part of the word was quoted or escaped. */
  quoted: boolean;
  expansions: Expansion[];
  /** Unquoted `*`, `?`, or `[` in the word. */
  glob: boolean;
  /** The word uses `$'...'` quoting (ANSI-C escapes). */
  ansiC: boolean;
}

export interface Redirect {
  /** `>`, `>>`, `<`, `<<`, `<<-`, `<<<`, `>&`, `<&`, `&>`, `&>>`, `>|`, `<>`. */
  op: string;
  fd: string | null;
  target: ShellWord | null;
  /** Here-document body for `<<` and `<<-`. */
  body?: string;
}

export interface FlowStep {
  pipeline: number;
  stage: number;
  length: number;
}

export type CommandOrigin =
  | 'top'
  | 'subshell'
  | 'group'
  | 'substitution'
  | 'process-substitution'
  | 'shell-c'
  | 'eval'
  | 'exec'
  | 'heredoc';

export interface Wrapper {
  /** Wrapper name, for example `sudo`, `env`, `xargs`, `npx`, `pnpm dlx`. */
  name: string;
  argv: string[];
  /** Packages a package runner fetches (`npx`, `pnpm dlx`, `bunx`, `yarn dlx`, `npm exec`). */
  packages?: string[];
}

export interface ShellCommand {
  /** The command that runs, after assignments and wrappers are removed. */
  argv: string[];
  words: ShellWord[];
  /** Base name of argv[0] (no directory, no .exe), lowercased for PowerShell. Empty for pure assignments. */
  name: string;
  assignments: Array<{ name: string; value: string; word: ShellWord }>;
  wrappers: Wrapper[];
  redirects: Redirect[];
  origin: CommandOrigin;
  /** The command whose argument or payload contains this one (substitutions, `bash -c`, `eval`, `-exec`). */
  parent: ShellCommand | null;
  /**
   * For substitutions: index in the parent's argv of the argument that holds this command;
   * -1 inside an assignment or a wrapper argument, -2 inside a redirect target. Null otherwise.
   */
  parentWord: number | null;
  depth: number;
  /** Pipeline positions, outermost first. Nested code inherits its parent's position. */
  flow: FlowStep[];
  /** Operator that joins this command's pipeline to the previous one: '', '&&', '||', ';', '&', '\n'. */
  joinedBy: string;
  background: boolean;
  /** Source text of the simple command. */
  text: string;
  index: number;
  dialect: ShellDialect;
}

export interface ShellParse {
  commands: ShellCommand[];
  errors: string[];
  dialect: ShellDialect;
}

export interface ShellOptions {
  dialect?: ShellDialect;
}

const MAX_DEPTH = 8;
const MAX_INPUT = 256 * 1024;

export function parseShell(input: string, options: ShellOptions = {}): ShellParse {
  const dialect = options.dialect ?? 'sh';
  const state: ParseState = { commands: [], errors: [], pipelineCounter: 0 };
  const text = input.length > MAX_INPUT ? input.slice(0, MAX_INPUT) : input;
  if (input.length > MAX_INPUT) state.errors.push('command truncated at 256 KB');
  try {
    parseInto(text, state, { origin: 'top', parent: null, parentWord: null, depth: 0, flow: [], dialect });
  } catch (error) {
    state.errors.push(`parse failed: ${(error as Error).message}`);
  }
  state.commands.forEach((c, i) => (c.index = i));
  return { commands: state.commands, errors: state.errors, dialect };
}

interface ParseState {
  commands: ShellCommand[];
  errors: string[];
  pipelineCounter: number;
}

interface Scope {
  origin: CommandOrigin;
  parent: ShellCommand | null;
  parentWord: number | null;
  depth: number;
  flow: FlowStep[];
  dialect: ShellDialect;
}

/** A parsed simple command before wrappers are removed, plus nested code to parse once the command exists. */
interface RawCommand {
  words: ShellWord[];
  redirects: Redirect[];
  text: string;
  /** Nested sources found in words: parsed after the command object exists so they can point to it. */
  /** `word` is the index in `words` of the word that holds the code, -2 for a redirect target, -3 for a block. */
  nested: Array<{ source: string; origin: CommandOrigin; word?: number }>;
  group?: { source: string; origin: 'subshell' | 'group' };
}

function parseInto(source: string, state: ParseState, scope: Scope): void {
  if (scope.depth > MAX_DEPTH) {
    state.errors.push('nesting too deep');
    return;
  }
  const lexer = new Lexer(source, scope.dialect, state.errors);
  const items = lexer.parseList();
  for (const item of items) {
    const pipelineId = state.pipelineCounter++;
    item.stages.forEach((stage, stageIndex) => {
      const flow = [...scope.flow, { pipeline: pipelineId, stage: stageIndex, length: item.stages.length }];
      const stageScope: Scope = { ...scope, flow };
      if (stage.group) {
        parseInto(stage.group.source, state, { ...stageScope, origin: stage.group.origin, depth: scope.depth + 1 });
        for (const n of stage.nested) parseInto(n.source, state, { ...stageScope, origin: n.origin, parentWord: null, depth: scope.depth + 1 });
        // Redirects on a group apply to its commands; they are rare enough to ignore.
        return;
      }
      buildCommand(stage, stageScope, state, item.joinedBy, item.background);
    });
  }
}

function buildCommand(raw: RawCommand, scope: Scope, state: ParseState, joinedBy: string, background: boolean): void {
  const words = [...raw.words];
  const assignments: ShellCommand['assignments'] = [];
  // Leading assignments and reserved words that introduce the next command (`if`, `then`, `do`, `!`).
  const dialect = scope.dialect;
  let changed = true;
  while (changed && words.length > 0) {
    changed = false;
    while (words.length > 0 && dialect === 'sh' && isAssignmentWord(words[0] as ShellWord)) {
      const w = words.shift() as ShellWord;
      const eq = w.value.indexOf('=');
      assignments.push({ name: w.value.slice(0, eq).replace(/\+$/, ''), value: w.value.slice(eq + 1), word: w });
      changed = true;
    }
    while (words.length > 0 && isLeadingKeyword(words[0] as ShellWord, dialect)) {
      words.shift();
      changed = true;
    }
  }
  const wrappers: Wrapper[] = [];
  const nestedFromWrappers: Array<{ source: string; origin: CommandOrigin }> = [];
  let guard = 0;
  while (words.length > 0 && guard++ < 12) {
    const stripped = stripWrapper(words, dialect, assignments, nestedFromWrappers);
    if (!stripped) break;
    wrappers.push(stripped);
  }
  const argv = words.map((w) => w.value);
  const removed = raw.words.length - words.length;
  const command: ShellCommand = {
    argv,
    words,
    name: commandName(argv[0] ?? '', dialect),
    assignments,
    wrappers,
    redirects: raw.redirects,
    origin: scope.origin,
    parent: scope.parent,
    parentWord: scope.parentWord,
    depth: scope.depth,
    flow: scope.flow,
    joinedBy,
    background,
    text: raw.text,
    index: 0,
    dialect,
  };
  const hasContent = argv.length > 0 || assignments.length > 0 || raw.redirects.length > 0;
  if (hasContent) state.commands.push(command);
  // Code nested in a command with no content (a function definition) belongs to the enclosing command.
  const owner = hasContent ? command : scope.parent;
  const nestedScope = (origin: CommandOrigin, nestedDialect: ShellDialect = dialect, parentWord: number | null = null): Scope => ({
    origin,
    parent: owner,
    parentWord: hasContent ? parentWord : scope.parentWord,
    depth: scope.depth + 1,
    flow: scope.flow,
    dialect: nestedDialect,
  });
  const argvIndex = (w: number | undefined): number | null => {
    if (w === undefined || w === -3) return null;
    if (w === -2) return -2;
    return w - removed < 0 ? -1 : w - removed;
  };
  for (const n of raw.nested) parseInto(n.source, state, nestedScope(n.origin, dialect, argvIndex(n.word)));
  for (const n of nestedFromWrappers) parseInto(n.source, state, nestedScope(n.origin, dialect, -1));
  for (const r of raw.redirects) {
    if (r.body !== undefined && isShellInterpreter(command.name) && !hasScriptOperand(command)) parseInto(r.body, state, nestedScope('heredoc'));
    if (r.op === '<<<' && r.target && isShellInterpreter(command.name) && !hasScriptOperand(command)) parseInto(r.target.value, state, nestedScope('heredoc'));
  }
  // Payloads that are shell code: bash -c '...', eval '...', find -exec ... \;
  // A payload built from a substitution was already parsed above as that substitution.
  const payload = shellPayloadWord(command);
  if (payload && !payload.word.expansions.some((e) => e.kind === 'command')) {
    parseInto(payload.code, state, nestedScope('shell-c', payload.dialect));
  }
  if (command.name === 'eval' && command.dialect === 'sh') {
    const literal = command.words.slice(1).filter((w) => !w.expansions.some((e) => e.kind === 'command'));
    const code = literal.map((w) => w.value).join(' ');
    if (code.trim() && literal.length === command.words.length - 1) parseInto(code, state, nestedScope('eval'));
  }
  if (command.name === 'find') {
    for (const exec of findExecCommands(command)) parseInto(exec, state, nestedScope('exec'));
  }
}

// ---------------------------------------------------------------------------
// Lexer

interface ListItem {
  stages: RawCommand[];
  joinedBy: string;
  background: boolean;
}

const SH_META = new Set([' ', '\t', '\n', '\r', '|', '&', ';', '<', '>', '(', ')']);
const PS_META = new Set([' ', '\t', '\n', '\r', '|', ';', '(', ')', '{', '}', '>', '<']);

class Lexer {
  private readonly src: string;
  private pos = 0;
  private readonly dialect: ShellDialect;
  private readonly errors: string[];
  private pendingHeredocs: Array<{ redirect: Redirect; delimiter: string; strip: boolean }> = [];
  private readingRedirect = false;

  constructor(src: string, dialect: ShellDialect, errors: string[]) {
    this.src = src;
    this.dialect = dialect;
    this.errors = errors;
  }

  /** Record nested code found in the word being read (or in a redirect target). */
  private pushNested(cmd: RawCommand, source: string, origin: CommandOrigin): void {
    cmd.nested.push({ source, origin, word: this.readingRedirect ? -2 : cmd.words.length });
  }

  parseList(): ListItem[] {
    const items: ListItem[] = [];
    let after = '';
    while (this.pos < this.src.length) {
      this.skipBlanks();
      if (this.pos >= this.src.length) break;
      const ch = this.src[this.pos] as string;
      if (ch === '\n') {
        this.pos++;
        this.readHeredocBodies();
        after = '\n';
        continue;
      }
      if (ch === ';') {
        this.pos++;
        if (this.src[this.pos] === ';' || this.src[this.pos] === '&') this.pos++;
        after = ';';
        continue;
      }
      if (ch === ')' || (ch === '}' && this.dialect === 'powershell')) {
        // Unbalanced closer (case patterns, stray parentheses): skip it.
        this.pos++;
        continue;
      }
      const stages = this.parsePipeline();
      if (stages.length === 0) {
        // Could not make progress: skip one character to avoid an endless loop.
        this.pos++;
        continue;
      }
      this.skipBlanks();
      let background = false;
      let next = '';
      if (this.src.startsWith('&&', this.pos)) {
        this.pos += 2;
        next = '&&';
      } else if (this.src.startsWith('||', this.pos)) {
        this.pos += 2;
        next = '||';
      } else if (this.src[this.pos] === '&' && this.dialect === 'sh') {
        this.pos++;
        background = true;
        next = '&';
      }
      items.push({ stages, joinedBy: after, background });
      after = next;
    }
    if (this.pendingHeredocs.length > 0) this.readHeredocBodies();
    return items;
  }

  private parsePipeline(): RawCommand[] {
    const stages: RawCommand[] = [];
    while (true) {
      this.skipBlanks();
      const cmd = this.parseCommand();
      if (!cmd) break;
      stages.push(cmd);
      this.skipBlanks();
      if (this.src[this.pos] === '|' && this.src[this.pos + 1] !== '|') {
        this.pos++;
        if (this.src[this.pos] === '&') this.pos++;
        // A newline after a pipe continues the pipeline.
        this.skipBlanks(true);
        continue;
      }
      break;
    }
    return stages;
  }

  private parseCommand(): RawCommand | null {
    const start = this.pos;
    const ch = this.src[this.pos];
    if (ch === undefined) return null;
    if (ch === '(' && this.dialect === 'sh' && this.src[this.pos + 1] !== '(') {
      const inner = this.readBalanced('(', ')');
      const cmd: RawCommand = { words: [], redirects: [], text: this.src.slice(start, this.pos), nested: [], group: { source: inner, origin: 'subshell' } };
      this.readTrailingRedirects(cmd);
      return cmd;
    }
    if (ch === '{' && this.dialect === 'sh' && /[\s]/.test(this.src[this.pos + 1] ?? '')) {
      const inner = this.readBraceGroup();
      const cmd: RawCommand = { words: [], redirects: [], text: this.src.slice(start, this.pos), nested: [], group: { source: inner, origin: 'group' } };
      this.readTrailingRedirects(cmd);
      return cmd;
    }
    if (ch === '{' && this.dialect === 'powershell') {
      const inner = this.readBalanced('{', '}');
      return { words: [], redirects: [], text: this.src.slice(start, this.pos), nested: [], group: { source: inner, origin: 'group' } };
    }
    const cmd: RawCommand = { words: [], redirects: [], text: '', nested: [] };
    let commentAt: number | undefined;
    while (this.pos < this.src.length) {
      this.skipBlanks();
      const c = this.src[this.pos];
      if (c === undefined || c === '\n' || c === ';' || c === '|' || c === ')') break;
      if (c === '&' && this.dialect === 'sh') {
        if (this.src[this.pos + 1] === '>') {
          this.readRedirect(cmd, null);
          continue;
        }
        break;
      }
      if (c === '&' && this.dialect === 'powershell' && this.src[this.pos + 1] === '&') break;
      if (c === '}' && this.dialect === 'powershell') break;
      if ((c === '<' || c === '>') && !this.isProcessSubstitution()) {
        this.readRedirect(cmd, null);
        continue;
      }
      if (c === '#' && this.atWordStart()) {
        // The command's text ends before its trailing comment.
        commentAt ??= this.pos;
        this.skipComment();
        continue;
      }
      if (this.dialect === 'powershell' && c === '<' && this.src[this.pos + 1] === '#') {
        const end = this.src.indexOf('#>', this.pos + 2);
        this.pos = end === -1 ? this.src.length : end + 2;
        continue;
      }
      if (c === '{' && this.dialect === 'powershell') {
        const inner = this.readBalanced('{', '}');
        cmd.nested.push({ source: inner, origin: 'group' });
        continue;
      }
      if (c === '(' && this.dialect === 'sh') {
        // `(( ... ))` arithmetic: skip it.
        if (this.src[this.pos + 1] === '(') {
          this.readBalanced('(', ')');
          continue;
        }
        const inner = this.readBalanced('(', ')');
        if (cmd.words.length === 1 && inner.trim() === '') {
          // `name() { ...; }` function definition: the body is parsed as nested code.
          cmd.words = [];
          this.skipBlanks(true);
          if (this.src[this.pos] === '{') cmd.nested.push({ source: this.readBraceGroup(), origin: 'group' });
          break;
        }
        // `x=(a b)` array assignments are handled in readWord; anything else is a subshell.
        cmd.nested.push({ source: inner, origin: 'subshell' });
        continue;
      }
      const fdStart = this.pos;
      const word = this.readWord(cmd);
      if (!word) {
        this.pos = Math.max(this.pos, fdStart + 1);
        continue;
      }
      // `2>file`, `1>&2`: a number right before a redirection operator is a file descriptor.
      const next = this.src[this.pos];
      if ((next === '>' || next === '<') && /^\d{1,2}$/.test(word.raw) && !this.isProcessSubstitution()) {
        this.readRedirect(cmd, word.raw);
        continue;
      }
      cmd.words.push(word);
    }
    cmd.text = this.src.slice(start, commentAt ?? this.pos).trim();
    if (cmd.words.length === 0 && cmd.redirects.length === 0 && cmd.nested.length === 0) return null;
    return cmd;
  }

  private readTrailingRedirects(cmd: RawCommand): void {
    while (true) {
      this.skipBlanks();
      const c = this.src[this.pos];
      if (c === '<' || c === '>') {
        this.readRedirect(cmd, null);
        continue;
      }
      if (c !== undefined && /\d/.test(c) && /^\d+[<>]/.test(this.src.slice(this.pos, this.pos + 4))) {
        const fd = /^\d+/.exec(this.src.slice(this.pos))?.[0] as string;
        this.pos += fd.length;
        this.readRedirect(cmd, fd);
        continue;
      }
      break;
    }
  }

  private isProcessSubstitution(): boolean {
    const c = this.src[this.pos];
    return this.dialect === 'sh' && (c === '<' || c === '>') && this.src[this.pos + 1] === '(';
  }

  private atWordStart(): boolean {
    if (this.pos === 0) return true;
    return /[\s;|&(]/.test(this.src[this.pos - 1] as string);
  }

  private skipComment(): void {
    while (this.pos < this.src.length && this.src[this.pos] !== '\n') this.pos++;
  }

  private skipBlanks(newlines = false): void {
    while (this.pos < this.src.length) {
      const c = this.src[this.pos];
      if (c === ' ' || c === '\t' || c === '\r') this.pos++;
      else if (c === '\\' && this.src[this.pos + 1] === '\n' && this.dialect === 'sh') this.pos += 2;
      else if (c === '`' && this.src[this.pos + 1] === '\n' && this.dialect === 'powershell') this.pos += 2;
      else if (newlines && c === '\n') {
        this.pos++;
        this.readHeredocBodies();
      } else if (newlines && c === '#' && this.atWordStart()) this.skipComment();
      else break;
    }
  }

  private readRedirect(cmd: RawCommand, fd: string | null): void {
    const ops = ['&>>', '&>', '<<<', '<<-', '<<', '<>', '<&', '>>', '>&', '>|', '<', '>'];
    let op = '';
    for (const candidate of ops) {
      if (this.src.startsWith(candidate, this.pos)) {
        op = candidate;
        break;
      }
    }
    if (!op) {
      this.pos++;
      return;
    }
    this.pos += op.length;
    this.skipBlanks();
    this.readingRedirect = true;
    const target = this.readWord(cmd);
    this.readingRedirect = false;
    const redirect: Redirect = { op, fd, target };
    cmd.redirects.push(redirect);
    if ((op === '<<' || op === '<<-') && target) {
      this.pendingHeredocs.push({ redirect, delimiter: target.value, strip: op === '<<-' });
    }
  }

  private readHeredocBodies(): void {
    while (this.pendingHeredocs.length > 0) {
      const h = this.pendingHeredocs.shift() as { redirect: Redirect; delimiter: string; strip: boolean };
      const lines: string[] = [];
      let found = false;
      while (this.pos < this.src.length) {
        let end = this.src.indexOf('\n', this.pos);
        if (end === -1) end = this.src.length;
        const line = this.src.slice(this.pos, end).replace(/\r$/, '');
        this.pos = Math.min(this.src.length, end + 1);
        const check = h.strip ? line.replace(/^\t+/, '') : line;
        if (check === h.delimiter) {
          found = true;
          break;
        }
        lines.push(h.strip ? line.replace(/^\t+/, '') : line);
      }
      if (!found) this.errors.push(`here-document not closed (${h.delimiter})`);
      h.redirect.body = lines.join('\n');
    }
  }

  /** Read from an opening character to its balanced closer, honoring quotes. Returns the inner text. */
  readBalanced(open: string, close: string): string {
    const start = this.pos + 1;
    let depth = 0;
    let i = this.pos;
    while (i < this.src.length) {
      const c = this.src[i] as string;
      if (c === '\\' && this.dialect === 'sh') {
        i += 2;
        continue;
      }
      if (c === '`' && this.dialect === 'powershell') {
        i += 2;
        continue;
      }
      if (c === "'") {
        const end = this.src.indexOf("'", i + 1);
        i = end === -1 ? this.src.length : end + 1;
        continue;
      }
      if (c === '"') {
        i = this.skipDoubleQuoted(i + 1);
        continue;
      }
      if (c === '`' && this.dialect === 'sh') {
        i = this.skipBacktick(i + 1);
        continue;
      }
      if (c === '#' && this.dialect === 'sh' && (i === 0 || /[\s;|&(]/.test(this.src[i - 1] as string)) && depth > 0) {
        while (i < this.src.length && this.src[i] !== '\n') i++;
        continue;
      }
      if (c === open) depth++;
      else if (c === close) {
        depth--;
        if (depth === 0) {
          this.pos = i + 1;
          return this.src.slice(start, i);
        }
      }
      i++;
    }
    this.errors.push(`unclosed ${open}`);
    this.pos = this.src.length;
    return this.src.slice(start);
  }

  /** `{ list; }` brace group: the closing brace must be a separate word. */
  private readBraceGroup(): string {
    const start = this.pos + 1;
    let depth = 0;
    let i = this.pos;
    while (i < this.src.length) {
      const c = this.src[i] as string;
      if (c === '\\') {
        i += 2;
        continue;
      }
      if (c === "'") {
        const end = this.src.indexOf("'", i + 1);
        i = end === -1 ? this.src.length : end + 1;
        continue;
      }
      if (c === '"') {
        i = this.skipDoubleQuoted(i + 1);
        continue;
      }
      if (c === '{' && (i === this.pos || /[\s;&|(]/.test(this.src[i - 1] as string))) depth++;
      else if (c === '}' && /[\s;&|]/.test(this.src[i - 1] as string)) {
        depth--;
        if (depth === 0) {
          this.pos = i + 1;
          return this.src.slice(start, i);
        }
      }
      i++;
    }
    this.errors.push('unclosed {');
    this.pos = this.src.length;
    return this.src.slice(start);
  }

  private skipDoubleQuoted(from: number): number {
    let i = from;
    while (i < this.src.length) {
      const c = this.src[i];
      if (c === '\\' && this.dialect === 'sh') {
        i += 2;
        continue;
      }
      if (c === '`' && this.dialect === 'powershell') {
        i += 2;
        continue;
      }
      if (c === '"') return i + 1;
      if (c === '$' && this.src[i + 1] === '(') {
        const saved = this.pos;
        this.pos = i + 1;
        this.readBalanced('(', ')');
        i = this.pos;
        this.pos = saved;
        continue;
      }
      i++;
    }
    return i;
  }

  private skipBacktick(from: number): number {
    let i = from;
    while (i < this.src.length) {
      const c = this.src[i];
      if (c === '\\') {
        i += 2;
        continue;
      }
      if (c === '`') return i + 1;
      i++;
    }
    return i;
  }

  /** Read one word. Nested command code found in it is added to cmd.nested. */
  readWord(cmd: RawCommand): ShellWord | null {
    return this.dialect === 'powershell' ? this.readPsWord(cmd) : this.readShWord(cmd);
  }

  private readShWord(cmd: RawCommand): ShellWord | null {
    const start = this.pos;
    let value = '';
    let quoted = false;
    let glob = false;
    let ansiC = false;
    const expansions: Expansion[] = [];
    const src = this.src;
    // Process substitution as a whole word: <(cmd) or >(cmd).
    if ((src[this.pos] === '<' || src[this.pos] === '>') && src[this.pos + 1] === '(') {
      this.pos++;
      const inner = this.readBalanced('(', ')');
      this.pushNested(cmd, inner, 'process-substitution');
      const text = src.slice(start, this.pos);
      return { raw: text, value: text, quoted: false, expansions: [{ kind: 'process', text, quoted: false, at: 0 }], glob: false, ansiC: false };
    }
    while (this.pos < src.length) {
      const c = src[this.pos] as string;
      if (SH_META.has(c)) {
        // `x=(a b c)` array assignment: keep the parenthesized list in the word.
        if (c === '(' && /^[A-Za-z_][A-Za-z0-9_]*\+?=$/.test(value) && !quoted) {
          const inner = this.readBalanced('(', ')');
          value += `(${inner})`;
          continue;
        }
        break;
      }
      if (c === '\\') {
        const next = src[this.pos + 1];
        if (next === '\n') {
          this.pos += 2;
          continue;
        }
        if (next !== undefined) value += next;
        quoted = true;
        this.pos += 2;
        continue;
      }
      if (c === "'") {
        const end = src.indexOf("'", this.pos + 1);
        const stop = end === -1 ? src.length : end;
        if (end === -1) this.errors.push('unclosed single quote');
        value += src.slice(this.pos + 1, stop);
        quoted = true;
        this.pos = stop + 1;
        continue;
      }
      if (c === '"') {
        quoted = true;
        this.pos++;
        while (this.pos < src.length && src[this.pos] !== '"') {
          const d = src[this.pos] as string;
          if (d === '\\') {
            const next = src[this.pos + 1];
            if (next === '\n') {
              this.pos += 2;
              continue;
            }
            if (next !== undefined && '$`"\\'.includes(next)) {
              value += next;
              this.pos += 2;
              continue;
            }
            value += d;
            this.pos++;
            continue;
          }
          if (d === '$' || d === '`') {
            const exp = this.readDollarOrBacktick(cmd, true, value.length);
            if (exp) {
              expansions.push(exp);
              value += exp.text;
              continue;
            }
          }
          value += d;
          this.pos++;
        }
        if (this.pos >= src.length) this.errors.push('unclosed double quote');
        this.pos++;
        continue;
      }
      if (c === '$' && src[this.pos + 1] === "'") {
        // ANSI-C quoting.
        ansiC = true;
        quoted = true;
        this.pos += 2;
        let raw = '';
        while (this.pos < src.length && src[this.pos] !== "'") {
          if (src[this.pos] === '\\' && this.pos + 1 < src.length) {
            raw += src.slice(this.pos, this.pos + 2);
            this.pos += 2;
            continue;
          }
          raw += src[this.pos];
          this.pos++;
        }
        this.pos++;
        value += decodeAnsiC(raw);
        continue;
      }
      if (c === '$' && src[this.pos + 1] === '"') {
        // Locale string: treat like a double-quoted string.
        this.pos++;
        continue;
      }
      if (c === '$' || c === '`') {
        const exp = this.readDollarOrBacktick(cmd, false, value.length);
        if (exp) {
          expansions.push(exp);
          value += exp.text;
          continue;
        }
      }
      if (c === '*' || c === '?' || c === '[') glob = true;
      value += c;
      this.pos++;
    }
    if (this.pos === start) return null;
    return { raw: src.slice(start, this.pos), value, quoted, expansions, glob, ansiC };
  }

  private readDollarOrBacktick(cmd: RawCommand, quoted: boolean, at: number): Expansion | null {
    const src = this.src;
    const start = this.pos;
    const c = src[this.pos];
    if (c === '`') {
      const end = this.skipBacktick(this.pos + 1);
      const inner = src.slice(this.pos + 1, Math.max(this.pos + 1, end - 1)).replace(/\\([`$\\])/g, '$1');
      this.pos = end;
      this.pushNested(cmd, inner, 'substitution');
      return { kind: 'command', text: src.slice(start, this.pos), quoted, at };
    }
    const next = src[this.pos + 1];
    if (next === '(') {
      if (src[this.pos + 2] === '(') {
        this.pos++;
        this.readBalanced('(', ')');
        return { kind: 'arith', text: src.slice(start, this.pos), quoted, at };
      }
      this.pos++;
      const inner = this.readBalanced('(', ')');
      this.pushNested(cmd, inner, 'substitution');
      return { kind: 'command', text: src.slice(start, this.pos), quoted, at };
    }
    if (next === '{') {
      this.pos++;
      const inner = this.readBalanced('{', '}');
      const name = /^[#!]?([A-Za-z_][A-Za-z0-9_]*|\d+|[@*#?$!-])/.exec(inner)?.[1];
      return { kind: 'var', text: src.slice(start, this.pos), name, quoted, at };
    }
    const m = /^\$([A-Za-z_][A-Za-z0-9_]*|\d|[@*#?$!-])/.exec(src.slice(this.pos, this.pos + 256));
    if (m) {
      this.pos += m[0].length;
      return { kind: 'var', text: m[0], name: m[1], quoted, at };
    }
    return null;
  }

  private readPsWord(cmd: RawCommand): ShellWord | null {
    const start = this.pos;
    let value = '';
    let quoted = false;
    let glob = false;
    const expansions: Expansion[] = [];
    const src = this.src;
    while (this.pos < src.length) {
      const c = src[this.pos] as string;
      if (c === '(' || (c === '$' && src[this.pos + 1] === '(') || (c === '@' && src[this.pos + 1] === '(')) {
        // Grouping or subexpression: `iex (iwr ...)`, `$(...)`, `(New-Object Net.WebClient).DownloadString(...)`.
        if (c !== '(') this.pos++;
        const at = value.length;
        const open = this.pos;
        const inner = this.readBalanced('(', ')');
        // A parenthesis right after a name is a method call such as .DownloadString('...'): keep it as text.
        const methodCall = c === '(' && open > start && /[\w\]]$/.test(src.slice(start, open));
        if (!methodCall) this.pushNested(cmd, inner, 'substitution');
        const text = src.slice(c === '(' ? open : open - 1, this.pos);
        if (!methodCall) expansions.push({ kind: 'command', text, quoted: false, at });
        value += text;
        continue;
      }
      if (PS_META.has(c)) break;
      if (c === '`') {
        const next = src[this.pos + 1];
        if (next === '\n') {
          this.pos += 2;
          continue;
        }
        if (next !== undefined) value += psEscape(next);
        quoted = true;
        this.pos += 2;
        continue;
      }
      if (c === '@' && (src[this.pos + 1] === "'" || src[this.pos + 1] === '"') && src[this.pos + 2] === '\n') {
        const quote = src[this.pos + 1] as string;
        const end = src.indexOf(`\n${quote}@`, this.pos + 2);
        const stop = end === -1 ? src.length : end;
        value += src.slice(this.pos + 3, stop);
        quoted = true;
        this.pos = end === -1 ? src.length : end + 3;
        continue;
      }
      if (c === "'") {
        quoted = true;
        this.pos++;
        while (this.pos < src.length) {
          if (src[this.pos] === "'") {
            if (src[this.pos + 1] === "'") {
              value += "'";
              this.pos += 2;
              continue;
            }
            break;
          }
          value += src[this.pos];
          this.pos++;
        }
        this.pos++;
        continue;
      }
      if (c === '"') {
        quoted = true;
        this.pos++;
        while (this.pos < src.length && src[this.pos] !== '"') {
          const d = src[this.pos] as string;
          if (d === '`') {
            const next = src[this.pos + 1];
            if (next !== undefined) value += psEscape(next);
            this.pos += 2;
            continue;
          }
          if (d === '$' && src[this.pos + 1] === '(') {
            const at = value.length;
            this.pos++;
            const inner = this.readBalanced('(', ')');
            this.pushNested(cmd, inner, 'substitution');
            const text = `$(${inner})`;
            expansions.push({ kind: 'command', text, quoted: true, at });
            value += text;
            continue;
          }
          if (d === '$') {
            const m = /^\$(\{[^}]*\}|[A-Za-z_][\w:]*)/.exec(src.slice(this.pos, this.pos + 256));
            if (m) {
              expansions.push({ kind: 'var', text: m[0], name: m[1]?.replace(/^\{|\}$/g, ''), quoted: true, at: value.length });
              value += m[0];
              this.pos += m[0].length;
              continue;
            }
          }
          value += d;
          this.pos++;
        }
        this.pos++;
        continue;
      }
      if (c === '$') {
        const m = /^\$(\{[^}]*\}|[A-Za-z_][\w:]*)/.exec(src.slice(this.pos, this.pos + 256));
        if (m) {
          expansions.push({ kind: 'var', text: m[0], name: m[1]?.replace(/^\{|\}$/g, ''), quoted: false, at: value.length });
          value += m[0];
          this.pos += m[0].length;
          continue;
        }
      }
      if (c === '&' && src[this.pos + 1] === '&') break;
      if (c === '*' || c === '?') glob = true;
      value += c;
      this.pos++;
    }
    if (this.pos === start) return null;
    return { raw: src.slice(start, this.pos), value, quoted, expansions, glob, ansiC: false };
  }
}

function psEscape(ch: string): string {
  const map: Record<string, string> = { n: '\n', t: '\t', r: '\r', '0': '\0', a: '\u0007', b: '\b', f: '\f', v: '\v' };
  return map[ch] ?? ch;
}

function decodeAnsiC(raw: string): string {
  return raw.replace(/\\(x[0-9a-fA-F]{1,2}|u[0-9a-fA-F]{1,4}|U[0-9a-fA-F]{1,8}|[0-7]{1,3}|c.|.)/g, (_m, esc: string) => {
    const kind = esc[0] as string;
    if (kind === 'x' || kind === 'u' || kind === 'U') {
      const code = Number.parseInt(esc.slice(1), 16);
      return Number.isFinite(code) && code <= 0x10ffff ? String.fromCodePoint(code) : '';
    }
    if (/[0-7]/.test(kind)) return String.fromCharCode(Number.parseInt(esc, 8) & 0xff);
    if (kind === 'c') return String.fromCharCode((esc.charCodeAt(1) ?? 64) & 0x1f);
    const simple: Record<string, string> = { n: '\n', t: '\t', r: '\r', a: '\u0007', b: '\b', e: '\u001b', E: '\u001b', f: '\f', v: '\v', '\\': '\\', "'": "'", '"': '"', '?': '?' };
    return simple[kind] ?? `\\${kind}`;
  });
}

// ---------------------------------------------------------------------------
// Words and wrappers

function isAssignmentWord(w: ShellWord): boolean {
  if (!/^[A-Za-z_][A-Za-z0-9_]*\+?=/.test(w.raw)) return false;
  return true;
}

const SH_LEADING = new Set(['if', 'then', 'elif', 'else', 'do', 'while', 'until', '!', '{']);
const SH_TRAILING = new Set(['fi', 'done', 'esac', '}']);

function isLeadingKeyword(w: ShellWord, dialect: ShellDialect): boolean {
  if (w.quoted) return false;
  if (dialect === 'powershell') return w.value === '&' || w.value === '.';
  return SH_LEADING.has(w.value) || SH_TRAILING.has(w.value);
}

export function commandName(arg0: string, dialect: ShellDialect = 'sh'): string {
  // A PowerShell expression such as `(New-Object Net.WebClient).DownloadString(...)` has no command name.
  if (dialect === 'powershell' && /^[($@]/.test(arg0)) return '';
  let name = arg0.replace(/\\/g, '/');
  name = name.slice(name.lastIndexOf('/') + 1);
  if (/\.(exe|cmd|bat|com)$/i.test(name)) name = name.replace(/\.(exe|cmd|bat|com)$/i, '');
  if (dialect === 'powershell' || /\.(exe|cmd|bat)$/i.test(arg0)) name = name.toLowerCase();
  return name;
}

const SHELLS = new Set(['sh', 'bash', 'zsh', 'dash', 'ksh', 'ash', 'mksh', 'fish', 'busybox']);

export function isShellInterpreter(name: string): boolean {
  return SHELLS.has(name);
}

function hasScriptOperand(cmd: ShellCommand): boolean {
  const args = cmd.argv.slice(1);
  for (let i = 0; i < args.length; i++) {
    const a = args[i] as string;
    if (a === '-c' || /^-[a-zA-Z]*c[a-zA-Z]*$/.test(a)) return true;
    if (a === '-s' || a === '-') return false;
    if (a === '--') return i + 1 < args.length;
    if (a.startsWith('-') || a.startsWith('+')) continue;
    return true;
  }
  return false;
}

/** The code string passed to `sh -c`, `bash -lc`, `zsh -c`, `pwsh -Command`, and similar. */
export function shellPayload(cmd: ShellCommand): string | null {
  return shellPayloadWord(cmd)?.code ?? null;
}

export interface ShellPayload {
  code: string;
  /** The word holding the code (for `-EncodedCommand`, the encoded word). */
  word: ShellWord;
  index: number;
  dialect: ShellDialect;
}

export function shellPayloadWord(cmd: ShellCommand): ShellPayload | null {
  const name = cmd.name.toLowerCase();
  const args = cmd.argv;
  if (SHELLS.has(name) && name !== 'busybox') {
    for (let i = 1; i < args.length; i++) {
      const a = args[i] as string;
      if (a === '--') return null;
      if (a === '-c' || /^-[a-zA-Z]*c[a-zA-Z]*$/.test(a)) {
        const word = cmd.words[i + 1];
        return word ? { code: word.value, word, index: i + 1, dialect: 'sh' } : null;
      }
      if (a === '-o' || a === '+o' || a === '-O' || a === '+O') {
        i++;
        continue;
      }
      if (!a.startsWith('-') && !a.startsWith('+')) return null;
    }
    return null;
  }
  if (name === 'pwsh' || name === 'powershell') {
    for (let i = 1; i < args.length; i++) {
      const a = (args[i] as string).toLowerCase();
      const word = cmd.words[i + 1];
      if (/^-(c|co|com|comm|comma|comman|command)$/.test(a)) {
        return word ? { code: args.slice(i + 1).join(' '), word, index: i + 1, dialect: 'powershell' } : null;
      }
      if (/^-(e|ec|en|enc|enco|encod|encode|encoded|encodedcommand)$/.test(a)) {
        const decoded = word ? decodePowerShellBase64(word.value) : null;
        return word && decoded ? { code: decoded, word, index: i + 1, dialect: 'powershell' } : null;
      }
    }
  }
  return null;
}

function decodePowerShellBase64(value: string): string | null {
  if (!/^[A-Za-z0-9+/=]{8,}$/.test(value)) return null;
  try {
    return Buffer.from(value, 'base64').toString('utf16le');
  } catch {
    return null;
  }
}

function findExecCommands(cmd: ShellCommand): string[] {
  const out: string[] = [];
  const args = cmd.argv;
  for (let i = 1; i < args.length; i++) {
    const a = args[i];
    if (a !== '-exec' && a !== '-execdir' && a !== '-ok' && a !== '-okdir') continue;
    const parts: string[] = [];
    let j = i + 1;
    for (; j < args.length; j++) {
      const b = args[j] as string;
      if (b === ';' || b === '+') break;
      parts.push(quoteForReparse(b));
    }
    if (parts.length > 0) out.push(parts.join(' '));
    i = j;
  }
  return out;
}

/** Quote an already-unquoted argument so it can be parsed again as one word. */
export function quoteForReparse(arg: string): string {
  if (/^[\w@%+=:,./{}-]+$/.test(arg)) return arg;
  return `'${arg.replace(/'/g, `'\\''`)}'`;
}

type WrapperNested = Array<{ source: string; origin: CommandOrigin }>;

/**
 * Remove one wrapper from the front of `words` (in place). Returns the wrapper,
 * or null when the first word is not a wrapper that runs another command.
 */
function stripWrapper(words: ShellWord[], dialect: ShellDialect, assignments: ShellCommand['assignments'], nested: WrapperNested): Wrapper | null {
  const first = words[0];
  if (!first) return null;
  const name = commandName(first.value, dialect);
  const values = words.map((w) => w.value);
  const take = (n: number, extra: Partial<Wrapper> = {}): Wrapper => {
    const removed = words.splice(0, n);
    return { name, argv: removed.map((w) => w.value), ...extra };
  };
  const afterOptions = (start: number, withValue: ReadonlySet<string>, longWithValue: ReadonlySet<string> = new Set()): number => {
    let i = start;
    while (i < values.length) {
      const a = values[i] as string;
      if (a === '--') return i + 1;
      if (!a.startsWith('-') || a === '-') return i;
      if (longWithValue.has(a)) {
        i += 2;
        continue;
      }
      if (a.startsWith('--')) {
        i++;
        continue;
      }
      // Short option cluster: the last letter may take a value.
      const last = a[a.length - 1] as string;
      i += withValue.has(last) && a.length === 2 ? 2 : 1;
    }
    return i;
  };
  if (dialect === 'powershell') {
    return null;
  }
  switch (name) {
    case 'sudo':
    case 'doas': {
      const i = afterOptions(1, new Set(['u', 'g', 'C', 'D', 'h', 'p', 'r', 't', 'U', 'T']), new Set(['--user', '--group', '--prompt', '--chdir', '--host']));
      if (i >= values.length) return null;
      return take(i);
    }
    case 'env': {
      let i = 1;
      const envAssignments: ShellCommand['assignments'] = [];
      let split: string | null = null;
      while (i < values.length) {
        const a = values[i] as string;
        if (a === '--') {
          i++;
          break;
        }
        if (a === '-u' || a === '--unset' || a === '-C' || a === '--chdir') {
          i += 2;
          continue;
        }
        if (a === '-S' || a === '--split-string') {
          split = values[i + 1] ?? null;
          i += 2;
          continue;
        }
        if (a.startsWith('-')) {
          i++;
          continue;
        }
        if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(a)) {
          const eq = a.indexOf('=');
          envAssignments.push({ name: a.slice(0, eq), value: a.slice(eq + 1), word: words[i] as ShellWord });
          i++;
          continue;
        }
        break;
      }
      if (split !== null) {
        assignments.push(...envAssignments);
        words.splice(0, words.length);
        nested.push({ source: split, origin: 'shell-c' });
        return { name, argv: values };
      }
      // `env` alone (or with only assignments) prints the environment: it is the command, not a wrapper.
      if (i >= values.length) return null;
      assignments.push(...envAssignments);
      return take(i);
    }
    case 'nohup':
    case 'setsid':
    case 'unbuffer':
    case 'caffeinate':
    case 'chronic': {
      if (values.length < 2) return null;
      const i = name === 'caffeinate' || name === 'setsid' ? afterOptions(1, new Set(['t', 'w'])) : 1;
      if (i >= values.length) return null;
      return take(i);
    }
    case 'time': {
      const i = afterOptions(1, new Set(['f', 'o']));
      if (i >= values.length) return null;
      return take(i);
    }
    case 'command': {
      if (values[1] === '-v' || values[1] === '-V') return null;
      const i = afterOptions(1, new Set());
      if (i >= values.length) return null;
      return take(i);
    }
    case 'exec': {
      const i = afterOptions(1, new Set(['a']));
      if (i >= values.length) return null;
      return take(i);
    }
    case 'builtin': {
      if (values.length < 2) return null;
      return take(1);
    }
    case 'nice':
    case 'ionice':
    case 'stdbuf':
    case 'chrt':
    case 'taskset': {
      const i = afterOptions(1, new Set(['n', 'c', 'p', 'i', 'o', 'e']), new Set(['--adjustment', '--class', '--classdata']));
      if (i >= values.length) return null;
      return take(i);
    }
    case 'timeout': {
      let i = afterOptions(1, new Set(['s', 'k']), new Set(['--signal', '--kill-after']));
      i++; // duration
      if (i >= values.length) return null;
      return take(i);
    }
    case 'watch': {
      const i = afterOptions(1, new Set(['n', 'd']), new Set(['--interval']));
      if (i >= values.length) return null;
      const rest = values.slice(i);
      if (rest.length === 1) {
        words.splice(0, words.length);
        nested.push({ source: rest[0] as string, origin: 'shell-c' });
        return { name, argv: values };
      }
      return take(i);
    }
    case 'xargs': {
      const i = afterOptions(1, new Set(['I', 'n', 'P', 'L', 'd', 'E', 's', 'a']), new Set(['--max-args', '--max-procs', '--delimiter', '--arg-file', '--replace', '--max-lines']));
      if (i >= values.length) return null;
      return take(i);
    }
    case 'cross-env':
    case 'cross-env-shell': {
      let i = 1;
      const envAssignments: ShellCommand['assignments'] = [];
      while (i < values.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(values[i] as string)) {
        const a = values[i] as string;
        const eq = a.indexOf('=');
        envAssignments.push({ name: a.slice(0, eq), value: a.slice(eq + 1), word: words[i] as ShellWord });
        i++;
      }
      if (i >= values.length) return null;
      assignments.push(...envAssignments);
      if (name === 'cross-env-shell') {
        const code = values.slice(i).join(' ');
        words.splice(0, words.length);
        nested.push({ source: code, origin: 'shell-c' });
        return { name, argv: values };
      }
      return take(i);
    }
    case 'dotenv':
    case 'env-cmd': {
      const i = afterOptions(1, new Set(['e', 'c', 'v', 'f', 'p']), new Set(['--file', '--environments']));
      if (i >= values.length) return null;
      return take(i);
    }
    case 'npx':
    case 'pnpx':
    case 'bunx':
      return stripPackageRunner(words, values, name, 1, nested);
    case 'npm': {
      const sub = values[1];
      if (sub === 'exec' || sub === 'x') return stripPackageRunner(words, values, 'npm exec', 2, nested);
      return null;
    }
    case 'pnpm': {
      const sub = values[1];
      if (sub === 'dlx') return stripPackageRunner(words, values, 'pnpm dlx', 2, nested);
      if (sub === 'exec') {
        const i = afterOptions(2, new Set(['C']));
        if (i >= values.length) return null;
        return take(i);
      }
      return null;
    }
    case 'yarn': {
      const sub = values[1];
      if (sub === 'dlx') return stripPackageRunner(words, values, 'yarn dlx', 2, nested);
      if (sub === 'exec') {
        if (values.length < 3) return null;
        return take(2);
      }
      return null;
    }
    case 'bun': {
      if (values[1] === 'x') return stripPackageRunner(words, values, 'bunx', 2, nested);
      return null;
    }
    default:
      return null;
  }
}

/**
 * Package runners: `npx [opts] pkg[@v] args`, `npx -p a -p b cmd`, `pnpm dlx`,
 * `bunx`, `yarn dlx`, `npm exec [--] pkg`. The first operand becomes argv[0]
 * (without its version); the packages it fetches are recorded on the wrapper.
 */
function stripPackageRunner(words: ShellWord[], values: string[], name: string, start: number, nested: WrapperNested): Wrapper | null {
  const packages: string[] = [];
  let i = start;
  let call: string | null = null;
  let noInstall = false;
  while (i < values.length) {
    const a = values[i] as string;
    if (a === '--') {
      i++;
      break;
    }
    if (!a.startsWith('-')) break;
    if (a === '-p' || a === '--package') {
      if (values[i + 1] !== undefined) packages.push(values[i + 1] as string);
      i += 2;
      continue;
    }
    if (a.startsWith('--package=')) {
      packages.push(a.slice('--package='.length));
      i++;
      continue;
    }
    if (a === '-c' || a === '--call') {
      call = values[i + 1] ?? null;
      i += 2;
      continue;
    }
    if (a === '--no-install' || a === '--no' || a === '--offline') noInstall = true;
    if (['--registry', '--cache', '--prefix', '--userconfig', '-w', '--workspace', '--shell', '--silent-fail', '--cwd', '-C', '--dir'].includes(a)) {
      i += 2;
      continue;
    }
    i++;
  }
  const removed = words.splice(0, i);
  const argv = removed.map((w) => w.value);
  if (call !== null) {
    words.splice(0, words.length);
    nested.push({ source: call, origin: 'shell-c' });
    return { name, argv, packages: noInstall ? [] : packages };
  }
  const first = words[0];
  if (!first) return { name, argv, packages: noInstall ? [] : packages };
  if (packages.length === 0 && !noInstall) packages.push(first.value);
  // argv[0] becomes the package's command name, without the version.
  const bare = stripVersion(first.value);
  if (bare !== first.value) words[0] = { ...first, value: bare };
  return { name, argv, packages: noInstall ? [] : packages };
}

/** `pkg@1.2.3` -> `pkg`, `@scope/pkg@^2` -> `@scope/pkg`. */
export function stripVersion(spec: string): string {
  const at = spec.indexOf('@', spec.startsWith('@') ? 1 : 0);
  return at > 0 ? spec.slice(0, at) : spec;
}

// ---------------------------------------------------------------------------
// Helpers for checks

/** Commands in the order they appear, with nested code after its owner. */
export function flatten(parse: ShellParse): ShellCommand[] {
  return parse.commands;
}

/** True when `a` runs before `b` in a pipeline they share (a's output flows toward b). */
export function isUpstream(a: ShellCommand, b: ShellCommand): boolean {
  for (const fa of a.flow) {
    const fb = b.flow.find((s) => s.pipeline === fa.pipeline);
    if (fb && fa.stage < fb.stage) return true;
  }
  return false;
}

/** True when `inner` is inside `outer`'s arguments, payload, or substitutions (at any depth). */
export function isInside(inner: ShellCommand, outer: ShellCommand): boolean {
  let p = inner.parent;
  while (p) {
    if (p === outer) return true;
    p = p.parent;
  }
  return false;
}

/** Split `-abc` into letters and `--name=value` into name and value. */
export interface ParsedArgs {
  /** Flags as written without leading dashes: `r`, `f`, `recursive`, `force`. */
  flags: Set<string>;
  /** Values for flags given as `--name=value` or `-o value` (for flags listed as taking values). */
  values: Map<string, string[]>;
  operands: string[];
  /** Indexes into argv of the operands. */
  operandIndexes: number[];
}

export function parseArgs(argv: readonly string[], start: number, valueFlags: ReadonlySet<string> = new Set()): ParsedArgs {
  const flags = new Set<string>();
  const values = new Map<string, string[]>();
  const operands: string[] = [];
  const operandIndexes: number[] = [];
  const addValue = (k: string, v: string) => values.set(k, [...(values.get(k) ?? []), v]);
  let i = start;
  let endOfOptions = false;
  while (i < argv.length) {
    const a = argv[i] as string;
    if (endOfOptions || a === '-' || !a.startsWith('-')) {
      operands.push(a);
      operandIndexes.push(i);
      i++;
      continue;
    }
    if (a === '--') {
      endOfOptions = true;
      i++;
      continue;
    }
    if (a.startsWith('--')) {
      const eq = a.indexOf('=');
      const name = eq === -1 ? a.slice(2) : a.slice(2, eq);
      flags.add(name);
      if (eq !== -1) addValue(name, a.slice(eq + 1));
      else if (valueFlags.has(name) && i + 1 < argv.length) {
        addValue(name, argv[i + 1] as string);
        i++;
      }
      i++;
      continue;
    }
    // Short cluster.
    const letters = a.slice(1);
    for (let j = 0; j < letters.length; j++) {
      const l = letters[j] as string;
      flags.add(l);
      if (valueFlags.has(l)) {
        const rest = letters.slice(j + 1);
        if (rest) addValue(l, rest);
        else if (i + 1 < argv.length) {
          addValue(l, argv[i + 1] as string);
          i++;
        }
        break;
      }
    }
    i++;
  }
  return { flags, values, operands, operandIndexes };
}
