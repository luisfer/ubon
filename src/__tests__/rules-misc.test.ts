import { mkdirSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { SecurityScanner } from '../scanners/security-scanner';
import { IacScanner } from '../scanners/iac-scanner';

describe('Misc rules', () => {
  const tmp = join(process.cwd(), '.tmp-rules-misc');
  beforeAll(() => { try { rmSync(tmp, { recursive: true, force: true }); } catch {} mkdirSync(tmp, { recursive: true }); });
  afterAll(() => { try { rmSync(tmp, { recursive: true, force: true }); } catch {} });

  it('flags secret logging (LOG001)', async () => {
    const fp = join(tmp, 'x.ts');
    writeFileSync(fp, `console.log('sk-TESTSECRET');`);
    const s = new SecurityScanner();
    const res = await s.scan({ directory: tmp });
    expect(res.some(r => r.ruleId === 'LOG001')).toBe(true);
  });

  it('flags Docker apt cache not cleaned (DOCKER004)', async () => {
    const df = join(tmp, 'Dockerfile');
    writeFileSync(df, `FROM node:20\nRUN apt-get update && apt-get install -y curl`);
    const iac = new IacScanner();
    const res = await iac.scan({ directory: tmp });
    expect(res.some(r => r.ruleId === 'DOCKER004')).toBe(true);
  });
});


