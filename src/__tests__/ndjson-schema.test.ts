import { existsSync, mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { spawnSync } from 'child_process';

const CLI = join(process.cwd(), 'dist', 'cli.js');
const hasDist = existsSync(CLI);

describe('CLI: --ndjson + --schema + deterministic JSON', () => {
  let dir: string;
  beforeAll(() => {
    if (!hasDist) return;
    dir = mkdtempSync(join(tmpdir(), 'ubon-output-'));
    mkdirSync(join(dir, 'app/api/chat'), { recursive: true });
    writeFileSync(
      join(dir, 'app/api/chat/route.ts'),
      `const apiKey = "sk-${'a'.repeat(48)}";\nexport async function POST() { return new Response(apiKey); }\n`
    );
  });

  afterAll(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  (hasDist ? it : it.skip)('emits one JSON object per line in --ndjson mode', () => {
    const res = spawnSync('node', [CLI, 'check', '-d', dir, '--ndjson', '--no-result-cache'], {
      encoding: 'utf8'
    });
    const lines = res.stdout.trim().split('\n').filter(Boolean);
    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines) {
      expect(() => JSON.parse(line)).not.toThrow();
    }
  });

  (hasDist ? it : it.skip)('--schema prints the JSON schema and exits 0', () => {
    const res = spawnSync('node', [CLI, 'check', '--schema'], { encoding: 'utf8' });
    expect(res.status).toBe(0);
    const obj = JSON.parse(res.stdout);
    expect(obj.$schema || obj.title || obj.properties).toBeTruthy();
  });

  (hasDist ? it : it.skip)('produces byte-for-byte identical --json output across runs', () => {
    const args = ['check', '-d', dir, '--json', '--no-result-cache'];
    const a = spawnSync('node', [CLI, ...args], { encoding: 'utf8' }).stdout;
    const b = spawnSync('node', [CLI, ...args], { encoding: 'utf8' }).stdout;
    expect(a).toBe(b);
  });
});
