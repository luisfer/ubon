import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { FrameworkScanner } from '../scanners/framework-scanner';

/**
 * Smoke tests for the framework rule pack. We don't try to cover every rule
 * exhaustively — `framework-rules.test.ts` does that for static analysis;
 * here we verify the scanner reaches into a real on-disk fixture.
 */
describe('FrameworkScanner integration', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'ubon-fw-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  const writeFile = (rel: string, content: string) => {
    const full = join(dir, rel);
    mkdirSync(join(full, '..'), { recursive: true });
    writeFileSync(full, content);
  };

  it('flags a Server Action with no auth (NEXT212)', async () => {
    writeFile(
      'app/actions.ts',
      `'use server';

export async function deleteUser(formData: FormData) {
  const id = formData.get('id');
  // ... db.users.delete({ where: { id } })
}
`
    );
    const scanner = new FrameworkScanner();
    const results = await scanner.scan({ directory: dir, verbose: false } as any);
    expect(results.some((r) => r.ruleId === 'NEXT212')).toBe(true);
  });

  it('flags Edge runtime + Node API misuse (EDGE001)', async () => {
    writeFile(
      'app/api/edge/route.ts',
      `import fs from 'fs';

export const runtime = 'edge';

export async function GET() {
  const data = fs.readFileSync('/tmp/foo');
  return new Response(data);
}
`
    );
    const scanner = new FrameworkScanner();
    const results = await scanner.scan({ directory: dir, verbose: false } as any);
    expect(results.some((r) => r.ruleId === 'EDGE001')).toBe(true);
  });
});
