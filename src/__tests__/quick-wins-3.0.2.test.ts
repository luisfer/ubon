import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { FrameworkScanner } from '../scanners/framework-scanner';
import { EnvScanner } from '../scanners/env-scanner';
import { AstSecurityScanner } from '../scanners/ast-security-scanner';
import { VibeScanner } from '../scanners/vibe-scanner';
import { resolvesViaTsconfigPaths } from '../utils/tsconfig-resolver';
import { UbonScan } from '../index';

describe('3.0.2 quick-wins — false-positive killers, noise reduction, new rules', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'ubon-302-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  const writeFile = (rel: string, content: string) => {
    const full = join(dir, rel);
    mkdirSync(join(full, '..'), { recursive: true });
    writeFileSync(full, content);
  };

  // ---- Tier 1 ----------------------------------------------------------

  describe('tsconfig paths resolver', () => {
    it('resolves @/lib/db via tsconfig paths (VIBE001 false positive killer)', () => {
      writeFile(
        'tsconfig.json',
        JSON.stringify({ compilerOptions: { paths: { '@/*': ['./*'] } } })
      );
      writeFile('lib/db.ts', 'export const db = {};');
      expect(resolvesViaTsconfigPaths('@/lib/db', dir)).toBe(true);
      expect(resolvesViaTsconfigPaths('@/lib/ghost', dir)).toBe(false);
    });

    it('resolves via baseUrl fallback', () => {
      writeFile(
        'tsconfig.json',
        JSON.stringify({ compilerOptions: { baseUrl: './src' } })
      );
      writeFile('src/components/Foo.tsx', 'export const Foo = () => null;');
      expect(resolvesViaTsconfigPaths('components/Foo', dir)).toBe(true);
    });

    it('suppresses VIBE001 when the alias resolves on disk', async () => {
      writeFile(
        'tsconfig.json',
        JSON.stringify({ compilerOptions: { paths: { '@/*': ['./*'] } } })
      );
      writeFile('package.json', JSON.stringify({ name: 'x', dependencies: {} }));
      writeFile('lib/db.ts', 'export const db = {};');
      writeFile('app/page.tsx', "import { db } from '@/lib/db';\n");
      const scanner = new VibeScanner();
      const results = await scanner.scan({ directory: dir, verbose: false } as any);
      expect(results.some((r) => r.ruleId === 'VIBE001')).toBe(false);
    });
  });

  describe('orchestrator-level dedup', () => {
    it('collapses duplicate (ruleId, file, line) findings', async () => {
      const raw = [
        { ruleId: 'SEC017', file: 'a.tsx', line: 12, confidence: 0.7, category: 'security', severity: 'medium', type: 'warning', message: 'x' },
        { ruleId: 'SEC017', file: 'a.tsx', line: 12, confidence: 0.9, category: 'security', severity: 'medium', type: 'warning', message: 'x (better)' },
        { ruleId: 'SEC017', file: 'a.tsx', line: 14, confidence: 0.8, category: 'security', severity: 'medium', type: 'warning', message: 'x' }
      ] as any;
      const scan = new UbonScan();
      const deduped = (scan as any).dedupeResults(raw);
      expect(deduped).toHaveLength(2);
      const l12 = deduped.find((r: any) => r.line === 12);
      expect(l12.confidence).toBe(0.9);
      expect(l12.message).toBe('x (better)');
    });
  });

  // ---- Tier 3 ----------------------------------------------------------

  describe('ENV008 — NEXT_PUBLIC_ connection-URL leak', () => {
    it('flags NEXT_PUBLIC_DATABASE_URL with postgres://', async () => {
      writeFile('.env.local', 'NEXT_PUBLIC_DATABASE_URL=postgres://u:p@h/db\n');
      writeFile('.gitignore', '.env*\n');
      const scanner = new EnvScanner();
      const results = await scanner.scan({ directory: dir, verbose: false } as any);
      expect(results.some((r) => r.ruleId === 'ENV008')).toBe(true);
    });

    it('does not flag a server-side DATABASE_URL', async () => {
      writeFile('.env.local', 'DATABASE_URL=postgres://u:p@h/db\n');
      writeFile('.gitignore', '.env*\n');
      const scanner = new EnvScanner();
      const results = await scanner.scan({ directory: dir, verbose: false } as any);
      expect(results.some((r) => r.ruleId === 'ENV008')).toBe(false);
    });

    it('also flags VITE_/PUBLIC_/EXPO_PUBLIC_ prefixes', async () => {
      writeFile(
        '.env.local',
        [
          'VITE_DATABASE_URL=mongodb://u:p@h/db',
          'PUBLIC_REDIS_URL=redis://u:p@h/0',
          'EXPO_PUBLIC_API_ENDPOINT=mysql://u:p@h/db'
        ].join('\n') + '\n'
      );
      writeFile('.gitignore', '.env*\n');
      const scanner = new EnvScanner();
      const results = await scanner.scan({ directory: dir, verbose: false } as any);
      expect(results.filter((r) => r.ruleId === 'ENV008').length).toBe(3);
    });
  });

  describe('SEC020 — SQL sink with string interpolation', () => {
    it('flags db.prepare(`... ${x} ...`)', async () => {
      writeFile('package.json', JSON.stringify({ name: 'x' }));
      writeFile(
        'app/api/notes/route.ts',
        "const rows = db.prepare(`SELECT * FROM notes WHERE title LIKE '%${q}%'`).all();\n"
      );
      const scanner = new AstSecurityScanner();
      const results = await scanner.scan({ directory: dir, verbose: false } as any);
      expect(results.some((r: any) => r.ruleId === 'SEC020')).toBe(true);
    });

    it('flags $queryRawUnsafe("... " + x)', async () => {
      writeFile('package.json', JSON.stringify({ name: 'x' }));
      writeFile(
        'lib/db.ts',
        "prisma.$queryRawUnsafe('SELECT * FROM u WHERE id = ' + userId);\n"
      );
      const scanner = new AstSecurityScanner();
      const results = await scanner.scan({ directory: dir, verbose: false } as any);
      expect(results.some((r: any) => r.ruleId === 'SEC020')).toBe(true);
    });

    it('does not flag a clean parameterised .prepare("... ?")', async () => {
      writeFile('package.json', JSON.stringify({ name: 'x' }));
      writeFile(
        'lib/db.ts',
        "const stmt = db.prepare('SELECT * FROM notes WHERE id = ?');\nstmt.get(id);\n"
      );
      const scanner = new AstSecurityScanner();
      const results = await scanner.scan({ directory: dir, verbose: false } as any);
      expect(results.some((r) => r.ruleId === 'SEC020')).toBe(false);
    });
  });

  describe('NEXT216 — Next 15 async params/searchParams', () => {
    it('flags `params: { id: string }` in app/notes/[id]/page.tsx', async () => {
      writeFile(
        'app/notes/[id]/page.tsx',
        "export default function NotePage({ params }: { params: { id: string } }) { return null; }\n"
      );
      const scanner = new FrameworkScanner();
      const results = await scanner.scan({ directory: dir, verbose: false } as any);
      expect(results.some((r) => r.ruleId === 'NEXT216')).toBe(true);
    });

    it('does NOT flag `params: Promise<{ id: string }>`', async () => {
      writeFile(
        'app/notes/[id]/page.tsx',
        "export default async function NotePage({ params }: { params: Promise<{ id: string }> }) { await params; return null; }\n"
      );
      const scanner = new FrameworkScanner();
      const results = await scanner.scan({ directory: dir, verbose: false } as any);
      expect(results.some((r) => r.ruleId === 'NEXT216')).toBe(false);
    });
  });

  describe('NEXT217 — hook usage without `use client`', () => {
    it('flags useState import in a .tsx with no directive', async () => {
      writeFile(
        'components/NoteList.tsx',
        "import { useState, useEffect } from 'react';\nexport function NoteList() { const [x, setX] = useState(0); return null; }\n"
      );
      const scanner = new FrameworkScanner();
      const results = await scanner.scan({ directory: dir, verbose: false } as any);
      expect(results.some((r) => r.ruleId === 'NEXT217')).toBe(true);
    });

    it('does NOT flag the same file with `use client`', async () => {
      writeFile(
        'components/NoteList.tsx',
        "'use client';\nimport { useState } from 'react';\nexport function NoteList() { const [x, setX] = useState(0); return null; }\n"
      );
      const scanner = new FrameworkScanner();
      const results = await scanner.scan({ directory: dir, verbose: false } as any);
      expect(results.some((r) => r.ruleId === 'NEXT217')).toBe(false);
    });

    it('does NOT flag a file that only imports non-hook react exports', async () => {
      writeFile(
        'components/Foo.tsx',
        "import { Fragment } from 'react';\nexport const Foo = () => <Fragment />;\n"
      );
      const scanner = new FrameworkScanner();
      const results = await scanner.scan({ directory: dir, verbose: false } as any);
      expect(results.some((r) => r.ruleId === 'NEXT217')).toBe(false);
    });
  });

  describe('NEXT218 / NEXT219 — next.config hints', () => {
    it('flags `reactStrictMode: false`', async () => {
      writeFile(
        'next.config.js',
        "module.exports = { reactStrictMode: false };\n"
      );
      const scanner = new FrameworkScanner();
      const results = await scanner.scan({ directory: dir, verbose: false } as any);
      expect(results.some((r) => r.ruleId === 'NEXT218')).toBe(true);
    });

    it('flags `experimental.serverActions: true`', async () => {
      writeFile(
        'next.config.js',
        "module.exports = { experimental: { serverActions: true } };\n"
      );
      const scanner = new FrameworkScanner();
      const results = await scanner.scan({ directory: dir, verbose: false } as any);
      expect(results.some((r) => r.ruleId === 'NEXT219')).toBe(true);
    });

    it('does not flag a clean next.config', async () => {
      writeFile(
        'next.config.js',
        "module.exports = { reactStrictMode: true };\n"
      );
      const scanner = new FrameworkScanner();
      const results = await scanner.scan({ directory: dir, verbose: false } as any);
      expect(results.some((r) => r.ruleId === 'NEXT218' || r.ruleId === 'NEXT219')).toBe(false);
    });
  });
});
