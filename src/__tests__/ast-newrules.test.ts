import { mkdirSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { AstSecurityScanner } from '../scanners/ast-security-scanner';

describe('AST new rules', () => {
  const tmp = join(process.cwd(), '.tmp-ast-newrules');
  beforeAll(() => { try { rmSync(tmp, { recursive: true, force: true }); } catch {} mkdirSync(tmp, { recursive: true }); });
  afterAll(() => { try { rmSync(tmp, { recursive: true, force: true }); } catch {} });

  // First AST scanner invocation in the suite pays the TS loader cold-start
  // cost, which can exceed the default 5s when the full suite is under load.
  it('flags React.createElement with non-literal type (SEC019)', async () => {
    const fp = join(tmp, 'a.tsx');
    writeFileSync(fp, `import React from 'react'; const Tag = (window as any).x; React.createElement(Tag, {});`);
    const s = new AstSecurityScanner();
    const res = await s.scan({ directory: tmp });
    expect(res.some(r => r.ruleId === 'SEC019')).toBe(true);
  }, 20000);

  it('flags dynamic import(userInput) (NEXT004)', async () => {
    const fp = join(tmp, 'b.ts');
    writeFileSync(fp, `const m = 'x' + location.search; import(m);`);
    const s = new AstSecurityScanner();
    const res = await s.scan({ directory: tmp });
    expect(res.some(r => r.ruleId === 'NEXT004')).toBe(true);
  });
});


