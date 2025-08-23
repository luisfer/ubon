import { mkdirSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { SecurityScanner } from '../scanners/security-scanner';
import { PythonSecurityScanner } from '../scanners/python-security-scanner';

describe('Inline suppressions', () => {
  const tmp = join(process.cwd(), '.tmp-supp-tests');
  beforeAll(() => { try { rmSync(tmp, { recursive: true, force: true }); } catch {} mkdirSync(tmp, { recursive: true }); });
  afterAll(() => { try { rmSync(tmp, { recursive: true, force: true }); } catch {} });

  it('respects // ubon-disable-next-line RULEID in JS/TS', async () => {
    const fp = join(tmp, 'x.ts');
    writeFileSync(fp, `// ubon-disable-next-line SEC015\nconsole.log('secret');`);
    const s = new SecurityScanner();
    const res = await s.scan({ directory: tmp });
    expect(res.find(r => r.ruleId === 'SEC015')).toBeUndefined();
  });

  it('respects ubon-disable-file in Python', async () => {
    const fp = join(tmp, 'y.py');
    writeFileSync(fp, `# ubon-disable-file\nimport subprocess\nsubprocess.Popen('ls', shell=True)`);
    const s = new PythonSecurityScanner();
    const res = await s.scan({ directory: tmp });
    expect(res.length).toBe(0);
  });
});


