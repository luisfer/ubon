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

  it('does not flag CSS/Tailwind noise for SEC018', async () => {
    const fp = join(tmp, 'styles.css');
    writeFileSync(fp, `.btn{color:#3b82f6} .bg{background:linear-gradient(#fff,#000)}`);
    const tw = join(tmp, 'tailwind.config.js');
    writeFileSync(tw, `module.exports={ theme:{ colors:{ primary:'#3b82f6' }}}`);
    const s = new SecurityScanner();
    const res = await s.scan({ directory: tmp });
    expect(res.some(r => r.ruleId === 'SEC018')).toBe(false);
  });

  it('flags obvious secret patterns for SEC018', async () => {
    const fp = join(tmp, 'app.ts');
    writeFileSync(fp, `const k = 'sk-1234567890abcdefZZZZ'; const jwt = 'eyJhbGciOiJIUzI1NiIs.eyJzdWIiOiIx'.repeat(1);`);
    const s = new SecurityScanner();
    const res = await s.scan({ directory: tmp });
    expect(res.some(r => r.ruleId === 'SEC018')).toBe(true);
  });
});


