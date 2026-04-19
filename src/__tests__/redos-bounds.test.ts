import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { SecurityScanner } from '../scanners/security-scanner';

/**
 * ReDoS regression: feed scanners a pathological input designed to trigger
 * catastrophic backtracking in the bounded `[\s\S]{0,N}?` patterns introduced
 * in v3. A well-bounded scan must finish in well under 1s; if a regression
 * reintroduces an unbounded `[\s\S]*` we'll see this test wedge.
 */
describe('ReDoS bounds', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'ubon-redos-'));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('completes within 2s on adversarial input', async () => {
    const evil = 'a'.repeat(50_000) + '\n' + 'export async function getServerSideProps(){return{props:{secret:"x".repeat(100)}}}\n' + 'a'.repeat(50_000);
    mkdirSync(join(dir, 'pages'), { recursive: true });
    writeFileSync(join(dir, 'pages/index.tsx'), evil);

    const scanner = new SecurityScanner();
    const start = Date.now();
    await scanner.scan({ directory: dir, verbose: false } as any);
    const elapsed = Date.now() - start;
    expect(elapsed).toBeLessThan(2000);
  });
});
