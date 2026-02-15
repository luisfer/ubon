import { existsSync, readFileSync } from 'fs';
import { spawnSync } from 'child_process';
import { join } from 'path';

const CLI = join(process.cwd(), 'dist', 'cli.js');
const hasDist = existsSync(CLI);

const run = (args: string[], cwd?: string) => {
  const res = spawnSync('node', [CLI, ...args], { cwd, encoding: 'utf8' });
  return res;
};

describe('CLI smoke', () => {
  (hasDist ? it : it.skip)('runs check --json on nextjs example', () => {
    const res = run(['check', '--directory', 'examples/faulty-nextjs-app', '--json']);
    expect(res.status === 0 || res.status === 1).toBe(true); // may fail due to --fail-on default
    const out = res.stdout.trim();
    const obj = JSON.parse(out);
    expect(obj.summary).toBeTruthy();
    expect(Array.isArray(obj.issues)).toBe(true);
  });

  (hasDist ? it : it.skip)('writes --output and --sarif files', () => {
    const outPath = join(process.cwd(), '.tmp-cli-output.json');
    const sarifPath = join(process.cwd(), '.tmp-cli-output.sarif');
    const res = run(['check', '--directory', 'examples/faulty-nextjs-app', '--json', '--output', outPath, '--sarif', sarifPath]);
    expect(res.status === 0 || res.status === 1).toBe(true);
    expect(existsSync(outPath)).toBe(true);
    expect(existsSync(sarifPath)).toBe(true);
    const data = JSON.parse(readFileSync(outPath, 'utf-8'));
    expect(data.schemaVersion).toBeTruthy();
  });

  (hasDist ? it : it.skip)('runs python profile on python example', () => {
    const res = run(['check', '--directory', 'examples/python-bad-app', '--json', '--profile', 'python']);
    expect(res.status === 0 || res.status === 1).toBe(true);
    const obj = JSON.parse(res.stdout.trim());
    expect(obj.summary).toBeTruthy();
  });

  (hasDist ? it : it.skip)('supports changed-files filtering', () => {
    const res = run(['check', '--directory', 'examples/faulty-nextjs-app', '--json', '--changed-files', 'src/pages/index.tsx']);
    const obj = JSON.parse(res.stdout.trim());
    const files = new Set((obj.issues || []).map((x: any) => x.file).filter(Boolean));
    for (const f of files) {
      expect(f === 'src/pages/index.tsx').toBe(true);
    }
  });

  (hasDist ? it : it.skip)('scan --skip-build skips link checks', () => {
    const res = run(['scan', '--directory', 'examples/nextjs-security-demo', '--json', '--skip-build', '--fail-on', 'none']);
    expect(res.status === 0 || res.status === 1).toBe(true);
    const obj = JSON.parse(res.stdout.trim());
    const hasLinkFindings = (obj.issues || []).some((x: any) => x.category === 'links' || String(x.ruleId || '').startsWith('LINK'));
    expect(hasLinkFindings).toBe(false);
  });

  (hasDist ? it : it.skip)('includes scorecard in JSON output when requested', () => {
    const res = run(['check', '--directory', 'examples/nextjs-security-demo', '--json', '--scorecard', '--fail-on', 'none']);
    expect(res.status === 0 || res.status === 1).toBe(true);
    const obj = JSON.parse(res.stdout.trim());
    expect(obj.scorecard).toBeTruthy();
    expect(typeof obj.scorecard.securityPosture).toBe('number');
  });

  (hasDist ? it : it.skip)('fails fast on invalid --fix-level', () => {
    const res = run(['check', '--directory', 'examples/nextjs-security-demo', '--json', '--preview-fixes', '--fix-level', 'invalid-level']);
    expect(res.status).toBe(1);
    const combinedOutput = `${res.stdout}\n${res.stderr}`;
    expect(combinedOutput).toContain('Unknown fix level');
  });
});


