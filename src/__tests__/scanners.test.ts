import { mkdirSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { SecurityScanner } from '../scanners/security-scanner';
import { AccessibilityScanner } from '../scanners/accessibility-scanner';
import { EnvScanner } from '../scanners/env-scanner';

describe('Scanners emit ruleId and confidence', () => {
  const tempDir = join(process.cwd(), '.tmp-scanner-tests');

  beforeAll(() => {
    try { rmSync(tempDir, { recursive: true, force: true }); } catch {}
    mkdirSync(tempDir, { recursive: true });
  });

  afterAll(() => {
    try { rmSync(tempDir, { recursive: true, force: true }); } catch {}
  });

  it('SecurityScanner returns ruleId and confidence', async () => {
    const filePath = join(tempDir, 'leak.ts');
    writeFileSync(filePath, `const key = "sk-test_abcdefghijklmnopqrstuvwxyz0123456789";`);

    const scanner = new SecurityScanner();
    const results = await scanner.scan({ directory: tempDir });

    expect(results.length).toBeGreaterThan(0);
    const finding = results[0];
    expect(typeof finding.ruleId).toBe('string');
    expect(typeof finding.confidence).toBe('number');
  });

  it('SecurityScanner ignores regex source patterns for secret rules', async () => {
    const filePath = join(tempDir, 'redaction.ts');
    writeFileSync(
      filePath,
      `const sanitize = (v: string) => v.replace(/sk-[A-Za-z0-9_-]{8,}/g, "sk-********");`
    );

    const scanner = new SecurityScanner();
    const results = await scanner.scan({ directory: tempDir, detailed: true });
    const sec001 = results.filter((r) => r.file?.includes('redaction.ts') && r.ruleId === 'SEC001');
    expect(sec001.length).toBe(0);
  });

  it('AccessibilityScanner returns ruleId and confidence', async () => {
    const filePath = join(tempDir, 'component.tsx');
    writeFileSync(filePath, `<img src="/x.png" />`);

    const scanner = new AccessibilityScanner();
    const results = await scanner.scan({ directory: tempDir });

    expect(results.length).toBeGreaterThan(0);
    const finding = results[0];
    expect(typeof finding.ruleId).toBe('string');
    expect(typeof finding.confidence).toBe('number');
  });

  it('EnvScanner returns ruleId and confidence', async () => {
    const envPath = join(tempDir, '.env');
    writeFileSync(envPath, `PASSWORD=supersecret`);

    const scanner = new EnvScanner();
    const results = await scanner.scan({ directory: tempDir });

    expect(results.length).toBeGreaterThan(0);
    const finding = results[0];
    expect(typeof finding.ruleId).toBe('string');
    expect(typeof finding.confidence).toBe('number');
  });
});


