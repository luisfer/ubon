import { SecurityScanner } from '../scanners/security-scanner';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

describe('NEXT210 server→client secret bleed', () => {
  it('flags when SSR reads env and returns secret in props', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ubon-next-ssr-'));
    const dir = path.join(tmp, 'pages');
    fs.mkdirSync(dir);
    const filePath = path.join(dir, 'index.ts');
    const content = `
export async function getServerSideProps() {
  const secret = process.env.OPENAI_API_KEY;
  return { props: { secret } };
}
export default function Home() { return null }
`;
    fs.writeFileSync(filePath, content);
    const scanner = new SecurityScanner();
    const results = await scanner.scan({ directory: tmp } as any);
    const has = results.find(r => r.ruleId === 'NEXT210');
    expect(has).toBeTruthy();
  });

  it('does not flag when prop is derived but non-sensitive', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ubon-next-ssr-ok-'));
    const dir = path.join(tmp, 'pages');
    fs.mkdirSync(dir);
    const filePath = path.join(dir, 'index.ts');
    const content = `
export async function getServerSideProps() {
  const name = process.env.NEXT_PUBLIC_APP_NAME;
  return { props: { title: 'hello ' + name } };
}
export default function Home() { return null }
`;
    fs.writeFileSync(filePath, content);
    const scanner = new SecurityScanner();
    const results = await scanner.scan({ directory: tmp } as any);
    const has = results.find(r => r.ruleId === 'NEXT210');
    expect(has).toBeFalsy();
  });
});


