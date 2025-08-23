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
});


