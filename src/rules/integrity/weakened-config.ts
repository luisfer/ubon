import type { Node } from '@babel/types';
import { posix } from 'node:path';
import { splitLines } from '../../core/diff.ts';
import type { Lang } from '../../core/files.ts';
import { unwrap } from '../../lang/js.ts';
import { parseSource } from '../../lang/parse.ts';
import { type PathKey, isRecord, parseStructured } from '../../lang/structured.ts';
import { dirName, snippet } from './shared.ts';

/**
 * Config comparisons for integrity/checks-weakened: TypeScript strictness,
 * coverage thresholds, lint rule severities, and package.json scripts that
 * swallow failures. Values are compared after parsing (JSON, JSONC, YAML, or
 * the object literal of a JavaScript config), never as text.
 */

export interface Weakening {
  line: number;
  message: string;
  fix: string;
  key: string;
  /** Set for findings that are likely but not certain (a check replaced by another command). */
  level?: 'warn';
}

type Reader = (path: string) => string | null;

// ---------------------------------------------------------------------------
// Values from JavaScript config files

export interface ValueAt {
  value: unknown;
  line: number;
}

const UNKNOWN = Symbol('unknown');

/**
 * Literal values of a JavaScript or TypeScript config file by key path
 * ("test.coverage.thresholds.lines"), following `export default`,
 * `module.exports`, `defineConfig(...)`, spreads, local constants, and
 * arrow functions that return an object.
 */
export function jsConfigValues(text: string, lang: Lang): Map<string, ValueAt> | null {
  const parsed = parseSource(text, lang);
  const block = parsed.blocks[0];
  if (!block) return null;
  const program = block.program.program;
  const locals = new Map<string, Node>();
  for (const stmt of program.body) {
    const decl = stmt.type === 'ExportNamedDeclaration' ? stmt.declaration : stmt;
    if (decl?.type === 'VariableDeclaration') for (const d of decl.declarations) if (d.id.type === 'Identifier' && d.init) locals.set(d.id.name, d.init as Node);
  }
  const out = new Map<string, ValueAt>();
  const seen = new Set<Node>();
  const visit = (node: Node | null | undefined, prefix: string, depth: number): void => {
    const n = unwrap(node);
    if (!n || depth > 40 || seen.has(n)) return;
    switch (n.type) {
      case 'ObjectExpression':
        seen.add(n);
        for (const prop of n.properties) {
          if (prop.type === 'SpreadElement') {
            visit(prop.argument as Node, prefix, depth + 1);
            continue;
          }
          if (prop.type !== 'ObjectProperty' || prop.computed) continue;
          const key = prop.key.type === 'Identifier' ? prop.key.name : prop.key.type === 'StringLiteral' ? prop.key.value : prop.key.type === 'NumericLiteral' ? String(prop.key.value) : null;
          if (key === null) continue;
          const path = prefix ? `${prefix}.${key}` : key;
          if (!out.has(`${path}#`)) out.set(`${path}#`, { value: UNKNOWN, line: prop.loc?.start.line ?? 1 });
          visit(prop.value as Node, path, depth + 1);
        }
        return;
      case 'ArrayExpression':
        seen.add(n);
        n.elements.forEach((el, i) => {
          if (el && el.type !== 'SpreadElement') visit(el as Node, `${prefix}[${i}]`, depth + 1);
        });
        return;
      case 'StringLiteral':
      case 'NumericLiteral':
      case 'BooleanLiteral':
        out.set(prefix, { value: n.value, line: n.loc?.start.line ?? 1 });
        return;
      case 'NullLiteral':
        out.set(prefix, { value: null, line: n.loc?.start.line ?? 1 });
        return;
      case 'UnaryExpression':
        if (n.operator === '-' && n.argument.type === 'NumericLiteral') out.set(prefix, { value: -n.argument.value, line: n.loc?.start.line ?? 1 });
        else if (n.operator === '!' && n.argument.type === 'NumericLiteral') out.set(prefix, { value: !n.argument.value, line: n.loc?.start.line ?? 1 });
        return;
      case 'Identifier': {
        const init = locals.get(n.name);
        if (init) visit(init, prefix, depth + 1);
        return;
      }
      case 'CallExpression':
        for (const arg of n.arguments) visit(arg as Node, prefix, depth + 1);
        return;
      case 'ArrowFunctionExpression':
      case 'FunctionExpression':
        if (n.body.type !== 'BlockStatement') visit(n.body as Node, prefix, depth + 1);
        else for (const s of n.body.body) if (s.type === 'ReturnStatement') visit(s.argument as Node, prefix, depth + 1);
        return;
      default:
        return;
    }
  };
  for (const stmt of program.body) {
    if (stmt.type === 'ExportDefaultDeclaration') visit(stmt.declaration as Node, '', 0);
    else if (stmt.type === 'ExpressionStatement' && stmt.expression.type === 'AssignmentExpression') {
      const left = stmt.expression.left;
      if (left.type === 'MemberExpression' && left.object.type === 'Identifier' && left.object.name === 'module' && left.property.type === 'Identifier' && left.property.name === 'exports') {
        visit(stmt.expression.right as Node, '', 0);
      }
    }
  }
  return out;
}

/** Values of a JSON, JSONC, or YAML document by key path, with lines. */
export function structuredValues(text: string, kind: 'json' | 'yaml', root: PathKey[] = []): Map<string, ValueAt> | null {
  const doc = parseStructured(text, kind);
  if (doc.data === undefined || (doc.errors.length > 0 && !isRecord(doc.data))) return null;
  let data: unknown = doc.data;
  for (const k of root) data = isRecord(data) ? data[String(k)] : undefined;
  const out = new Map<string, ValueAt>();
  if (data === undefined) return out;
  const visit = (value: unknown, path: PathKey[]) => {
    const key = path.slice(root.length).map((p, i) => (typeof p === 'number' ? `[${p}]` : i === 0 ? p : `.${p}`)).join('');
    if (isRecord(value)) {
      if (key) out.set(`${key}#`, { value: UNKNOWN, line: doc.lineOf(path) ?? 1 });
      for (const [k, v] of Object.entries(value)) visit(v, [...path, k]);
    } else if (Array.isArray(value)) {
      if (key) out.set(`${key}#`, { value: UNKNOWN, line: doc.lineOf(path) ?? 1 });
      value.forEach((v, i) => visit(v, [...path, i]));
    } else {
      out.set(key, { value, line: doc.valueLineOf(path) ?? doc.lineOf(path) ?? 1 });
    }
  };
  visit(data, root);
  return out;
}

/** The line of a key, or of its nearest parent that still exists. */
function lineNear(values: Map<string, ValueAt>, path: string): number {
  let p = path;
  while (p) {
    const hit = values.get(`${p}#`) ?? values.get(p);
    if (hit) return hit.line;
    const cut = Math.max(p.lastIndexOf('.'), p.lastIndexOf('['));
    if (cut <= 0) break;
    p = p.slice(0, cut);
  }
  return 1;
}

// ---------------------------------------------------------------------------
// TypeScript

const STRICT_FAMILY = ['noImplicitAny', 'strictNullChecks', 'strictFunctionTypes', 'strictBindCallApply', 'strictPropertyInitialization', 'noImplicitThis', 'useUnknownInCatchVariables', 'alwaysStrict'];
const EXTRA_CHECKS = ['noUncheckedIndexedAccess', 'exactOptionalPropertyTypes', 'noImplicitReturns', 'noImplicitOverride', 'noFallthroughCasesInSwitch', 'checkJs'];

interface TsOptions {
  own: Record<string, unknown>;
  inherited: Record<string, unknown>;
  extendsValue: unknown;
}

function readTsOptions(text: string, path: string, read: Reader, depth = 0): TsOptions | null {
  const doc = parseStructured(text, 'json');
  if (!isRecord(doc.data)) return null;
  const own = isRecord(doc.data.compilerOptions) ? doc.data.compilerOptions : {};
  const inherited: Record<string, unknown> = {};
  const ext = doc.data.extends;
  const targets = typeof ext === 'string' ? [ext] : Array.isArray(ext) ? ext.filter((e): e is string => typeof e === 'string') : [];
  if (depth < 4) {
    for (const target of targets) {
      const resolved = resolveExtends(target, path, read);
      if (!resolved) continue;
      const parent = readTsOptions(resolved.text, resolved.path, read, depth + 1);
      if (parent) Object.assign(inherited, parent.inherited, parent.own);
    }
  }
  return { own, inherited, extendsValue: ext };
}

function resolveExtends(target: string, from: string, read: Reader): { path: string; text: string } | null {
  const dir = dirName(from);
  const candidates: string[] = [];
  if (target.startsWith('.')) {
    const base = posix.normalize(posix.join(dir || '.', target));
    candidates.push(base.endsWith('.json') ? base : `${base}.json`, `${base}/tsconfig.json`);
  } else {
    for (const nm of [dir ? `${dir}/node_modules` : 'node_modules', 'node_modules']) {
      const base = `${nm}/${target}`;
      candidates.push(base.endsWith('.json') ? base : `${base}.json`, `${base}/tsconfig.json`);
    }
  }
  for (const c of candidates) {
    const text = read(c);
    if (text !== null) return { path: c, text };
  }
  return null;
}

function effective(options: TsOptions, flag: string): boolean {
  const pick = (o: Record<string, unknown>) => (typeof o[flag] === 'boolean' ? (o[flag] as boolean) : undefined);
  const own = pick(options.own);
  if (own !== undefined) return own;
  const inherited = pick(options.inherited);
  if (inherited !== undefined) return inherited;
  if (STRICT_FAMILY.includes(flag)) return effective(options, 'strict');
  return false;
}

export function tsconfigWeakenings(path: string, before: string, after: string, read: Reader): Weakening[] {
  const b = readTsOptions(before, path, read);
  const a = readTsOptions(after, path, read);
  if (!b || !a) return [];
  const values = structuredValues(after, 'json') ?? new Map<string, ValueAt>();
  const out: Weakening[] = [];
  const strictOff = effective(b, 'strict') && !effective(a, 'strict');
  const line = (flag: string) => values.get(`compilerOptions.${flag}`)?.line ?? lineNear(values, 'compilerOptions') ?? 1;
  if (strictOff) {
    out.push({
      line: values.has('compilerOptions.strict') ? line('strict') : values.has('extends') ? (values.get('extends')?.line ?? 1) : line('strict'),
      message: `\`strict\` is now off in ${path}, so TypeScript stops checking null, implicit any, and the other strict rules.`,
      fix: 'Turn `strict` back on and fix the type errors it reports.',
      key: 'strict',
    });
  }
  for (const flag of [...STRICT_FAMILY, ...EXTRA_CHECKS]) {
    if (!effective(b, flag) || effective(a, flag)) continue;
    // Covered by the strict finding unless the flag itself was switched off.
    if (strictOff && STRICT_FAMILY.includes(flag) && a.own[flag] !== false) continue;
    out.push({
      line: line(flag),
      message: `\`${flag}\` is now off in ${path}, which weakens type checking.`,
      fix: `Turn \`${flag}\` back on and fix the type errors it reports.`,
      key: flag,
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Coverage thresholds

const METRICS = new Set(['lines', 'functions', 'branches', 'statements']);

interface Threshold {
  /** Normalized identity: "jest:global.lines", "vitest:lines", "nyc:lines". */
  id: string;
  value: number | boolean;
  line: number;
  label: string;
}

/** Coverage thresholds in a parsed config, keyed by a normalized identity. */
export function thresholds(values: Map<string, ValueAt>, tool: 'jest' | 'vitest' | 'nyc'): Map<string, Threshold> {
  const out = new Map<string, Threshold>();
  for (const [path, v] of values) {
    if (path.endsWith('#')) continue;
    const parts = path.split('.');
    const last = parts[parts.length - 1] as string;
    if (tool === 'jest') {
      const i = parts.lastIndexOf('coverageThreshold');
      if (i === -1 || !METRICS.has(last) || typeof v.value !== 'number') continue;
      const scope = parts.slice(i + 1, -1).join('.') || 'global';
      out.set(`jest:${scope}.${last}`, { id: `jest:${scope}.${last}`, value: v.value, line: v.line, label: `coverageThreshold.${scope}.${last}` });
    } else if (tool === 'vitest') {
      const i = parts.lastIndexOf('coverage');
      if (i === -1) continue;
      const rest = parts.slice(i + 1);
      const inThresholds = rest[0] === 'thresholds';
      const metricPath = inThresholds ? rest.slice(1) : rest;
      if (metricPath.length === 1 && (METRICS.has(last) || last === '100')) {
        if (last === '100' ? typeof v.value !== 'boolean' : typeof v.value !== 'number') continue;
        out.set(`vitest:${last}`, { id: `vitest:${last}`, value: v.value as number | boolean, line: v.line, label: `coverage.thresholds.${last}` });
      } else if (inThresholds && metricPath.length === 2 && METRICS.has(last) && typeof v.value === 'number') {
        // Per-glob thresholds: thresholds['src/utils/**'].lines
        out.set(`vitest:${metricPath[0]}.${last}`, { id: `vitest:${metricPath[0]}.${last}`, value: v.value, line: v.line, label: `coverage.thresholds.${metricPath.join('.')}` });
      }
    } else {
      if (parts.length !== 1) continue;
      if (METRICS.has(last) && typeof v.value === 'number') out.set(`nyc:${last}`, { id: `nyc:${last}`, value: v.value, line: v.line, label: last });
      if ((last === 'check-coverage' || last === 'checkCoverage') && typeof v.value === 'boolean') out.set('nyc:check', { id: 'nyc:check', value: v.value, line: v.line, label: last });
      if (last === '100' && typeof v.value === 'boolean') out.set('nyc:100', { id: 'nyc:100', value: v.value, line: v.line, label: '100' });
    }
  }
  return out;
}

export function thresholdWeakenings(path: string, before: Map<string, Threshold>, after: Map<string, Threshold>, afterValues: Map<string, ValueAt>, anchor: string): Weakening[] {
  const out: Weakening[] = [];
  for (const [id, b] of before) {
    const a = after.get(id);
    if (typeof b.value === 'boolean') {
      if (b.value && (!a || a.value === false)) {
        out.push({
          line: a?.line ?? lineNear(afterValues, anchor),
          message: a ? `\`${b.label}\` was turned off in ${path}, so coverage is no longer enforced there.` : `\`${b.label}: true\` was removed from ${path}, so coverage is no longer enforced there.`,
          fix: `Restore \`${b.label}: true\`.`,
          key: id,
        });
      }
      continue;
    }
    if (!a) {
      out.push({ line: lineNear(afterValues, anchor), message: `The coverage threshold \`${b.label}\` (${b.value}) was removed from ${path}.`, fix: `Restore the \`${b.label}\` threshold of ${b.value}.`, key: id });
      continue;
    }
    if (typeof a.value !== 'number') continue;
    const bothNegative = b.value < 0 && a.value < 0;
    const bothPositive = b.value >= 0 && a.value >= 0;
    if ((bothPositive || bothNegative) && a.value < b.value) {
      out.push({
        line: a.line,
        message: `The coverage threshold \`${a.label}\` was lowered from ${b.value} to ${a.value} in ${path}.`,
        fix: `Restore the threshold to ${b.value} and add tests for the uncovered code instead.`,
        key: id,
      });
    }
  }
  return out;
}

/** Python: `fail_under` (coverage.py) and `--cov-fail-under` (pytest-cov). */
export function pythonCoverageWeakenings(path: string, before: string, after: string): Weakening[] {
  const find = (text: string) => {
    const lines = splitLines(text);
    const out = new Map<string, { value: number; line: number }>();
    lines.forEach((l, i) => {
      if (/^\s*[#;]/.test(l)) return;
      const m = /^\s*fail_under\s*=\s*([\d.]+)/.exec(l);
      if (m && !out.has('fail_under')) out.set('fail_under', { value: Number(m[1]), line: i + 1 });
      const c = /--cov-fail-under[= ]([\d.]+)/.exec(l);
      if (c && !out.has('--cov-fail-under')) out.set('--cov-fail-under', { value: Number(c[1]), line: i + 1 });
    });
    return out;
  };
  const b = find(before);
  const a = find(after);
  const out: Weakening[] = [];
  for (const [name, bv] of b) {
    const av = a.get(name);
    if (!av) out.push({ line: 1, message: `The coverage threshold \`${name}\` (${bv.value}) was removed from ${path}.`, fix: `Restore \`${name}\` at ${bv.value}.`, key: name });
    else if (av.value < bv.value) out.push({ line: av.line, message: `The coverage threshold \`${name}\` was lowered from ${bv.value} to ${av.value} in ${path}.`, fix: `Restore \`${name}\` to ${bv.value} and add tests for the uncovered code instead.`, key: name });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Lint rule severities

function severity(value: unknown): number | null {
  const v = Array.isArray(value) ? value[0] : value;
  if (v === 2 || v === 'error') return 2;
  if (v === 1 || v === 'warn') return 1;
  if (v === 0 || v === 'off') return 0;
  return null;
}

interface RuleSetting {
  severity: number;
  line: number;
  rule: string;
}

/** ESLint or oxlint rules in a JSON/YAML config: top level and overrides, keyed by files and rule. */
export function eslintRulesFromValues(values: Map<string, ValueAt>): Map<string, RuleSetting> {
  const out = new Map<string, RuleSetting>();
  const record = (scope: string, rule: string, value: unknown, line: number) => {
    const s = severity(value);
    if (s !== null) out.set(`${scope}|${rule}`, { severity: s, line, rule });
  };
  const filesOf = (prefix: string) => {
    const globs: string[] = [];
    for (const [k, v] of values) if (k.startsWith(`${prefix}files`) && typeof v.value === 'string') globs.push(v.value);
    return globs.join(',');
  };
  for (const [path, v] of values) {
    if (path.endsWith('#')) continue;
    const m = /^(|overrides\[\d+\]\.)(?:rules|categories)\.(.+?)(\[0\])?$/.exec(path);
    if (!m) continue;
    const scope = m[1] ? filesOf(m[1]) : '';
    const rule = m[2] as string;
    if (rule.includes('[')) continue;
    record(`${path.includes('categories') ? 'category:' : ''}${scope}`, rule, v.value, v.line);
  }
  return out;
}

/** ESLint flat config (eslint.config.js): every `rules` object, keyed by the config's `files` and the rule. */
export function eslintFlatRules(text: string, lang: Lang): Map<string, RuleSetting> | null {
  const parsed = parseSource(text, lang);
  const block = parsed.blocks[0];
  if (!block || parsed.failed) return null;
  const out = new Map<string, RuleSetting>();
  const visit = (node: Node, depth: number): void => {
    if (depth > 200) return;
    if (node.type === 'ObjectExpression') {
      let filesText = '';
      let rulesNode: Node | null = null;
      for (const prop of node.properties) {
        if (prop.type !== 'ObjectProperty' || prop.computed) continue;
        const key = prop.key.type === 'Identifier' ? prop.key.name : prop.key.type === 'StringLiteral' ? prop.key.value : null;
        if (key === 'files' && prop.value.start != null && prop.value.end != null) filesText = text.slice(prop.value.start, prop.value.end).replace(/\s+/g, '');
        if (key === 'rules') rulesNode = unwrap(prop.value as Node);
      }
      if (rulesNode?.type === 'ObjectExpression') {
        for (const r of rulesNode.properties) {
          if (r.type !== 'ObjectProperty' || r.computed) continue;
          const rule = r.key.type === 'StringLiteral' ? r.key.value : r.key.type === 'Identifier' ? r.key.name : null;
          if (!rule) continue;
          const v = unwrap(r.value as Node);
          const first = v?.type === 'ArrayExpression' ? (v.elements[0] as Node | null) : v;
          const value = first?.type === 'StringLiteral' || first?.type === 'NumericLiteral' ? first.value : undefined;
          const s = severity(value);
          if (s !== null) out.set(`${filesText}|${rule}`, { severity: s, line: r.loc?.start.line ?? 1, rule });
        }
      }
    }
    for (const [key, value] of Object.entries(node) as Array<[string, unknown]>) {
      if (key === 'loc' || key === 'start' || key === 'end' || key === 'extra' || key === 'comments' || key === 'leadingComments' || key === 'trailingComments') continue;
      if (Array.isArray(value)) for (const item of value) if (item && typeof item === 'object' && typeof (item as Node).type === 'string') visit(item as Node, depth + 1);
      if (value && typeof value === 'object' && typeof (value as Node).type === 'string') visit(value as Node, depth + 1);
    }
  };
  visit(block.program.program, 0);
  return out;
}

const SEVERITY_NAME = ['off', 'warn', 'error'];

export function lintRuleWeakenings(path: string, tool: string, before: Map<string, RuleSetting>, after: Map<string, RuleSetting>): Weakening[] {
  const out: Weakening[] = [];
  for (const [key, b] of before) {
    const a = after.get(key);
    if (!a || b.severity !== 2 || a.severity >= 2) continue;
    const category = key.startsWith('category:');
    out.push({
      line: a.line,
      message: `The ${tool} ${category ? 'category' : 'rule'} \`${b.rule}\` was moved from error to ${SEVERITY_NAME[a.severity]} in ${path}.`,
      fix: `Set \`${b.rule}\` back to error and fix what it reports, or disable it only on the lines that need it with a reason.`,
      key,
    });
  }
  return out;
}

/** Biome: the linter or recommended rules turned off, or rules moved down from error. */
export function biomeWeakenings(path: string, before: Map<string, ValueAt>, after: Map<string, ValueAt>): Weakening[] {
  const out: Weakening[] = [];
  const level = (v: unknown): number | null => (v === 'error' ? 3 : v === 'on' ? 2.5 : v === 'warn' ? 2 : v === 'info' ? 1 : v === 'off' ? 0 : null);
  for (const [key, flag] of [['linter.enabled', 'the Biome linter'], ['linter.rules.recommended', 'the Biome recommended rules']] as const) {
    const b = before.get(key);
    const a = after.get(key);
    if (b?.value !== false && a?.value === false) {
      out.push({ line: a.line, message: `\`${key}: false\` turns off ${flag} in ${path}.`, fix: `Remove \`${key}: false\` and fix what Biome reports.`, key });
    }
  }
  for (const [key, b] of before) {
    const m = /^linter\.rules\.(\w+)\.(\w+)(?:\.level)?$/.exec(key);
    if (!m) continue;
    const a = after.get(key);
    if (!a) continue;
    const lb = level(b.value);
    const la = level(a.value);
    if (lb === null || la === null) continue;
    if ((lb === 3 && la < 2.5) || (lb === 2.5 && la === 0)) {
      out.push({ line: a.line, message: `The Biome rule \`${m[1]}/${m[2]}\` was moved from ${String(b.value)} to ${String(a.value)} in ${path}.`, fix: `Set \`${m[2]}\` back to ${String(b.value)} and fix what it reports.`, key });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// package.json scripts

/** Commands that run tests, linters, or type checks. */
export const CHECK_COMMAND =
  /\b(?:(?:npm|pnpm|yarn|bun)\s+(?:(?:run|--silent|-s|--if-present|-r|--recursive|--filter[= ]\S+|-F\s+\S+|--workspace[= ]\S+|-w\s+\S+|workspace\s+\S+)\s+)*(?:test|tests|lint|typecheck|type-check|types|check|tsc|e2e|coverage|verify|validate)(?:[:\w-]*)|npm\s+t|npx\s+(?:jest|vitest|mocha|ava|tsc|eslint|biome|oxlint|vue-tsc|svelte-check|c8|nyc|playwright|cypress)|jest|vitest|mocha|ava|tsc|vue-tsc|svelte-check|eslint|oxlint|biome\s+(?:check|lint|ci)|playwright\s+test|cypress\s+run|node\s+--test|deno\s+(?:test|lint|check)|bun\s+test|pytest|tox|nox|mypy|pyright|ruff\s+check|flake8|pylint|go\s+(?:test|vet)|golangci-lint|cargo\s+(?:test|clippy|nextest)|dotnet\s+test|mvn\b[^\n]*\b(?:test|verify)|gradlew?\b[^\n]*\b(?:test|check)|rspec|phpunit|mix\s+test|swift\s+test|flutter\s+test|turbo\s+(?:run\s+)?(?:test|lint|typecheck|check)|nx\s+(?:run-many|affected)[^\n]*\b(?:test|lint|typecheck))(?![\w-])/;

const CHECK_SCRIPT_NAME = /^(test|tests|check|ci|verify|validate|lint|typecheck|type-check|types|tsc|e2e|coverage)([:_-].*)?$/;

/** A command that ignores the exit code of what it runs. */
export function swallowsFailure(command: string, shell: 'sh' | 'bash-e'): string | null {
  const m = /\|\|\s*(true|:|exit\s+0|echo\b[^|&;]*|printf\b[^|&;]*)\s*(?:$|[;&|])/.exec(command);
  if (m) return `|| ${(m[1] ?? '').trim().split(/\s+/)[0]}`;
  if (shell === 'sh' && /;\s*(exit\s+0|true)\s*$/.test(command)) return `; ${/;\s*(exit\s+0|true)\s*$/.exec(command)?.[1]}`;
  return null;
}

const PASS_WITH_NO_TESTS = /--passWithNoTests\b|--pass-with-no-tests\b/;
const NO_OP = /^\s*(echo\b.*|true|:|exit\s+0)?\s*$/;

export function scriptWeakenings(path: string, beforeText: string, afterText: string): Weakening[] {
  const b = parseStructured(beforeText, 'json');
  const a = parseStructured(afterText, 'json');
  if (!isRecord(b.data) || !isRecord(a.data)) return [];
  const bs = isRecord(b.data.scripts) ? b.data.scripts : {};
  const as = isRecord(a.data.scripts) ? a.data.scripts : {};
  const out: Weakening[] = [];
  for (const [name, beforeCmd] of Object.entries(bs)) {
    const afterCmd = as[name];
    if (typeof beforeCmd !== 'string' || typeof afterCmd !== 'string' || beforeCmd === afterCmd) continue;
    const isCheck = CHECK_SCRIPT_NAME.test(name) || CHECK_COMMAND.test(beforeCmd);
    if (!isCheck) continue;
    const line = a.valueLineOf(['scripts', name]) ?? a.lineOf(['scripts']) ?? 1;
    const swallowedNow = swallowsFailure(afterCmd, 'sh');
    if (swallowedNow && !swallowsFailure(beforeCmd, 'sh')) {
      out.push({ line, message: `The \`${name}\` script now ends in \`${swallowedNow}\`, so it succeeds even when the checks fail.`, fix: `Remove \`${swallowedNow}\` and fix the failures.`, key: `script:${name}:swallow` });
      continue;
    }
    if (PASS_WITH_NO_TESTS.test(afterCmd) && !PASS_WITH_NO_TESTS.test(beforeCmd)) {
      const flag = PASS_WITH_NO_TESTS.exec(afterCmd)?.[0] ?? '--passWithNoTests';
      out.push({ line, message: `\`${flag}\` was added to the \`${name}\` script, so it passes when no tests are found.`, fix: `Remove \`${flag}\` so a missing or misnamed test suite fails the run.`, key: `script:${name}:no-tests` });
      continue;
    }
    if (CHECK_COMMAND.test(beforeCmd) && !CHECK_COMMAND.test(afterCmd) && NO_OP.test(afterCmd)) {
      out.push({ line, message: `The \`${name}\` script was replaced with \`${snippet(afterCmd, 40)}\` and no longer runs \`${snippet(beforeCmd, 40)}\`.`, fix: `Restore the \`${name}\` script.`, key: `script:${name}:no-op` });
    }
  }
  return out;
}
