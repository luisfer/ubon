import { mkdirSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { AstSecurityScanner } from '../scanners/ast-security-scanner';

describe('AST Security Scanner', () => {
  const tmp = join(process.cwd(), '.tmp-ast-tests');

  beforeAll(() => {
    try { rmSync(tmp, { recursive: true, force: true }); } catch {}
    mkdirSync(tmp, { recursive: true });
  });

  afterAll(() => {
    try { rmSync(tmp, { recursive: true, force: true }); } catch {}
  });

  it('detects eval, dangerouslySetInnerHTML, env fallback, and fetch without signal', async () => {
    const fileTs = join(tmp, 'a.tsx');
    writeFileSync(fileTs, `
      // eval
      eval('console.log(1)');
      // dangerouslySetInnerHTML
      const c = { dangerouslySetInnerHTML: { __html: '<b>x</b>' } };
      // env fallback
      const api = process.env.API_URL || 'https://example.com';
      // fetch without signal
      fetch('/api/data');
    `);

    const scanner = new AstSecurityScanner();
    const results = await scanner.scan({ directory: tmp });
    const ruleIds = new Set(results.map(r => r.ruleId));
    expect(ruleIds.has('SEC016')).toBe(true);
    expect(ruleIds.has('SEC017')).toBe(true);
    expect(ruleIds.has('SEC008')).toBe(true);
    expect(ruleIds.has('JSNET001')).toBe(true);
  });
});


