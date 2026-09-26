import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { parseConfig } from '../../src/core/config.ts';
import { runCheck } from '../../src/core/engine.ts';
import type { Finding, Level } from '../../src/core/types.ts';
import { ruleIds } from '../../src/rules/index.ts';
import { expandFakeKeysInDir } from './fake-keys.ts';
import { FIXTURES, commitAll, copyTree, initRepo, listFilesRecursive, readJson, replaceTree, tempDir } from './fixtures.ts';

/**
 * Rule fixtures live in fixtures/rules/<pack>/<name>/. A fixture is a small
 * project. Expectations are comments on the line of the expected finding:
 *
 *   const key = 'sk-proj-...'   // expect: secret/provider-key
 *   const key = 'sk_test_...'   // expect-warn: secret/provider-key
 *   fetch(new URL('/x', base))  // ok: constant path on a fixed base
 *
 * `ok:` comments document the safe shapes; block rules need at least five.
 * Files that cannot hold comments list expectations in expect.json:
 *   { "files": { ".mcp.json": [{ "line": 6 }, { "line": 9, "level": "warn" }] }, "ok": ["..."] }
 *
 * fixture.json (optional) sets how the fixture runs:
 *   { "git": true, "untracked": [".env.local"], "config": { ... }, "mode": "all" }
 * A fixture with before/ and after/ folders runs in diff mode: before/ is
 * committed, then replaced by after/.
 */

export interface FixtureCase {
  rule: string;
  name: string;
  dir: string;
}

interface FixtureOptions {
  git?: boolean;
  untracked?: string[];
  config?: Record<string, unknown>;
  mode?: 'all' | 'diff' | 'staged';
  /** Session mode: extra rule context such as agent sessions. */
  session?: boolean;
}

export interface Expectation {
  file: string;
  line: number;
  level?: Level;
}

export function listFixtureCases(): FixtureCase[] {
  const root = join(FIXTURES, 'rules');
  if (!existsSync(root)) return [];
  const out: FixtureCase[] = [];
  for (const pack of readdirSync(root).sort()) {
    const packDir = join(root, pack);
    if (!statSync(packDir).isDirectory()) continue;
    for (const name of readdirSync(packDir).sort()) {
      const dir = join(packDir, name);
      if (!statSync(dir).isDirectory()) continue;
      const rule = `${pack}/${name}`;
      const cases = readdirSync(dir).filter((d) => d.startsWith('case-') && statSync(join(dir, d)).isDirectory());
      if (cases.length === 0) out.push({ rule, name: 'default', dir });
      else for (const c of cases.sort()) out.push({ rule, name: c.slice('case-'.length), dir: join(dir, c) });
    }
  }
  return out;
}

const EXPECT = /\bexpect(?:-(warn|block))?:\s*([a-z]+\/[a-z0-9-]+(?:\s*,\s*[a-z]+\/[a-z0-9-]+)*)/g;
const OK = /\bok:\s*\S/;

export function readExpectations(dir: string, rule: string): { expected: Expectation[]; okCount: number } {
  const expected: Expectation[] = [];
  let okCount = 0;
  for (const file of listFilesRecursive(dir)) {
    if (file === 'fixture.json' || file === 'expect.json') continue;
    const text = readFileSync(join(dir, file), 'utf8');
    text.split('\n').forEach((line, i) => {
      if (OK.test(line)) okCount++;
      EXPECT.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = EXPECT.exec(line))) {
        for (const id of (m[2] ?? '').split(/\s*,\s*/)) {
          if (id !== rule) continue;
          expected.push({ file, line: i + 1, ...(m[1] ? { level: m[1] as Level } : {}) });
        }
      }
    });
  }
  const sidecar = join(dir, 'expect.json');
  if (existsSync(sidecar)) {
    const data = readJson<{ files?: Record<string, Array<{ line: number; level?: Level }>>; ok?: string[] }>(sidecar);
    for (const [file, list] of Object.entries(data.files ?? {})) for (const e of list) expected.push({ file, ...e });
    okCount += data.ok?.length ?? 0;
  }
  return { expected, okCount };
}

export interface FixtureResult {
  findings: Finding[];
  expected: Expectation[];
  okCount: number;
  problems: string[];
}

export async function runFixture(fixture: FixtureCase): Promise<FixtureResult> {
  const optionsPath = join(fixture.dir, 'fixture.json');
  const options: FixtureOptions = existsSync(optionsPath) ? readJson<FixtureOptions>(optionsPath) : {};
  const isDiff = existsSync(join(fixture.dir, 'before')) && existsSync(join(fixture.dir, 'after'));
  const work = tempDir();
  const known = ruleIds();
  const config = parseConfig(options.config ?? {}, known);
  let expectDir = fixture.dir;
  if (isDiff) {
    initRepo(work);
    copyTree(join(fixture.dir, 'before'), work);
    expandFakeKeysInDir(work);
    commitAll(work, 'base');
    replaceTree(work, join(fixture.dir, 'after'));
    expandFakeKeysInDir(work);
    expectDir = join(fixture.dir, 'after');
  } else {
    copyTree(fixture.dir, work);
    expandFakeKeysInDir(work);
    if (options.git) {
      initRepo(work);
      commitAll(work, 'fixture', options.untracked ?? []);
    }
  }
  const mode = isDiff ? options.mode ?? 'diff' : 'all';
  const { report } = await runCheck({
    cwd: work,
    mode: mode === 'staged' ? 'staged' : mode,
    ...(isDiff && mode === 'diff' ? { base: 'HEAD' } : {}),
    rules: [fixture.rule],
    config,
    useBaseline: false,
    inSession: options.session ?? false,
  });
  const { expected, okCount } = readExpectations(expectDir, fixture.rule);
  const findings = report.findings.filter((f) => f.rule === fixture.rule && !['fixture.json', 'expect.json'].includes(f.file));
  const problems: string[] = [];
  const remaining = [...findings];
  for (const e of expected) {
    const index = remaining.findIndex((f) => f.file === e.file && f.range.start.line === e.line && (!e.level || f.level === e.level));
    if (index === -1) {
      const other = findings.find((f) => f.file === e.file && f.range.start.line === e.line);
      problems.push(
        other
          ? `${e.file}:${e.line}: expected level ${e.level} but got ${other.level} (${other.message})`
          : `${e.file}:${e.line}: expected a ${fixture.rule} finding${e.level ? ` (${e.level})` : ''}, got none`,
      );
    } else remaining.splice(index, 1);
  }
  for (const f of remaining) problems.push(`${f.file}:${f.range.start.line}: unexpected ${f.level} finding: ${f.message}`);
  for (const n of report.notChecked) if (/internal error/.test(n)) problems.push(`rule error: ${n}`);
  return { findings, expected, okCount, problems };
}
