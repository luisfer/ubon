import { mkdirSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { SecurityScanner } from '../scanners/security-scanner';
import { IacScanner } from '../scanners/iac-scanner';

describe('Framework/infra rules', () => {
  const tmp = join(process.cwd(), '.tmp-framework-tests');
  beforeAll(() => { try { rmSync(tmp, { recursive: true, force: true }); } catch {} mkdirSync(tmp, { recursive: true }); });
  afterAll(() => { try { rmSync(tmp, { recursive: true, force: true }); } catch {} });

  it('flags Next.js API route without validation (NEXT003)', async () => {
    const dir = join(tmp, 'pages/api');
    mkdirSync(dir, { recursive: true });
    const fp = join(dir, 'hello.ts');
    writeFileSync(fp, `export default function handler(req,res){ const x = req.body.name; res.status(200).json({x}); }`);
    const s = new SecurityScanner();
    const res = await s.scan({ directory: tmp });
    expect(res.some(r => r.ruleId === 'NEXT003')).toBe(true);
  });

  it('flags Next.js SSR secrets in getServerSideProps/getStaticProps (NEXT006)', async () => {
    const pdir = join(tmp, 'pages');
    mkdirSync(pdir, { recursive: true });
    const fp = join(pdir, 'index.tsx');
    writeFileSync(fp, `export async function getServerSideProps(){ const k=process.env.SECRET_KEY; return { props: { k } } } export default function P(){return null}`);
    const s = new SecurityScanner();
    const res = await s.scan({ directory: tmp });
    expect(res.some(r => r.ruleId === 'NEXT006')).toBe(true);
  });

  it('flags Vue v-html usage (VUE001)', async () => {
    const fp = join(tmp, 'App.vue');
    writeFileSync(fp, `<template><div v-html="raw"></div></template><script setup lang="ts">const raw='x'</script>`);
    const s = new SecurityScanner();
    const res = await s.scan({ directory: tmp });
    expect(res.some(r => r.ruleId === 'VUE001')).toBe(true);
  });

  it('flags GitHub Actions secrets echoed (GHA001)', async () => {
    const ghaDir = join(tmp, '.github/workflows');
    mkdirSync(ghaDir, { recursive: true });
    const wf = join(ghaDir, 'ci.yml');
    const content = 'name: ci\njobs:\n  build:\n    steps:\n      - run: echo ${{ secrets.NPM_TOKEN }}';
    writeFileSync(wf, content.replace(/\$\{\{/, '${{')); // avoid TS template parsing
    const iac = new IacScanner();
    const res = await iac.scan({ directory: tmp });
    expect(res.some(r => r.ruleId === 'GHA001')).toBe(true);
  });
});


