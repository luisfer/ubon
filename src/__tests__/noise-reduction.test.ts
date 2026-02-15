import { mkdirSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { SecurityScanner } from '../scanners/security-scanner';
import { DevelopmentScanner } from '../scanners/development-scanner';

describe('Noise reduction defaults', () => {
  const tmp = join(process.cwd(), '.tmp-noise-reduction');

  beforeAll(() => {
    try { rmSync(tmp, { recursive: true, force: true }); } catch {}
    mkdirSync(join(tmp, 'src', '__tests__'), { recursive: true });
    writeFileSync(join(tmp, 'src', 'app.ts'), 'export const ok = true;');
    writeFileSync(
      join(tmp, 'src', '__tests__', 'fixture.test.ts'),
      `
      // TODO: remove this before production
      eval("alert('xss')");
      const key = "sk-test_abcdefghijklmnopqrstuvwxyz1234";
      const placeholderApi = "https://example.com";
      `
    );
  });

  afterAll(() => {
    try { rmSync(tmp, { recursive: true, force: true }); } catch {}
  });

  it('ignores test files by default in security scanner', async () => {
    const scanner = new SecurityScanner();
    const results = await scanner.scan({ directory: tmp });
    expect(results.some((r) => r.file?.includes('__tests__'))).toBe(false);
  });

  it('includes test files when detailed mode is enabled in security scanner', async () => {
    const scanner = new SecurityScanner();
    const results = await scanner.scan({ directory: tmp, detailed: true });
    expect(results.some((r) => r.file?.includes('__tests__'))).toBe(true);
  });

  it('ignores test files by default in development scanner', async () => {
    const scanner = new DevelopmentScanner();
    const results = await scanner.scan({ directory: tmp });
    expect(results.some((r) => r.file?.includes('__tests__'))).toBe(false);
  });

  it('includes test files when detailed mode is enabled in development scanner', async () => {
    const scanner = new DevelopmentScanner();
    const results = await scanner.scan({ directory: tmp, detailed: true });
    expect(results.some((r) => r.file?.includes('__tests__'))).toBe(true);
  });
});
