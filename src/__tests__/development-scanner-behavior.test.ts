import { mkdirSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { DevelopmentScanner } from '../scanners/development-scanner';

describe('DevelopmentScanner behavior', () => {
  const tmp = join(process.cwd(), '.tmp-development-scanner');

  beforeAll(() => {
    try { rmSync(tmp, { recursive: true, force: true }); } catch {}
    mkdirSync(join(tmp, 'src', 'rules'), { recursive: true });
  });

  afterAll(() => {
    try { rmSync(tmp, { recursive: true, force: true }); } catch {}
  });

  it('detects TODO comments in regular source files', async () => {
    writeFileSync(join(tmp, 'src', 'main.ts'), '// TODO: implement feature');
    const scanner = new DevelopmentScanner();
    const results = await scanner.scan({ directory: tmp, detailed: true });
    const todo = results.find((r) => r.ruleId === 'DEV001' && r.file?.includes('main.ts'));
    expect(todo).toBeTruthy();
  });

  it('skips rule-definition metadata lines to reduce false positives', async () => {
    writeFileSync(
      join(tmp, 'src', 'rules', 'custom-rule.ts'),
      `export const rule = { message: 'TODO/FIXME comments detected', pattern: /TODO/gi, fix: 'Remove TODO' };`
    );
    const scanner = new DevelopmentScanner();
    const results = await scanner.scan({ directory: tmp, detailed: true });
    const fromRuleFile = results.filter((r) => r.file?.includes('custom-rule.ts'));
    expect(fromRuleFile.length).toBe(0);
  });
});
