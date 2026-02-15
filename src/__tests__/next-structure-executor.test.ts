import { runNextStructureChecks, NextStructureState } from '../scanners/security/executors/next-structure-executor';

function baseState(overrides: Partial<NextStructureState> = {}): NextStructureState {
  return {
    hasAppDir: true,
    hasPagesDir: false,
    hasNotFoundApp: false,
    has404Pages: false,
    hasErrorApp: false,
    hasErrorPages: false,
    hasDocumentPages: false,
    emittedMissing404: false,
    emittedMissingErrorBoundary: false,
    emittedMissingDocument: false,
    ...overrides
  };
}

describe('next structure executor', () => {
  const confidenceReasons = {
    NEXT201: 'Missing 404/not-found page in Next.js app',
    NEXT202: 'Missing error boundary in Next.js app'
  };

  it('emits missing not-found and missing error boundary once', () => {
    const state = baseState();
    const firstResults = runNextStructureChecks({
      file: 'app/page.tsx',
      content: 'export default function Page() {}',
      state,
      confidenceReasons
    });
    const secondResults = runNextStructureChecks({
      file: 'app/layout.tsx',
      content: 'export default function Layout() {}',
      state,
      confidenceReasons
    });

    expect(firstResults.some((r) => r.ruleId === 'NEXT201')).toBe(true);
    expect(firstResults.some((r) => r.ruleId === 'NEXT202')).toBe(true);
    expect(secondResults.some((r) => r.ruleId === 'NEXT201')).toBe(false);
    expect(secondResults.some((r) => r.ruleId === 'NEXT202')).toBe(false);
  });

  it('emits NEXT203 when pages router uses next/head without _document', () => {
    const state = baseState({
      hasAppDir: false,
      hasPagesDir: true
    });
    const results = runNextStructureChecks({
      file: 'pages/index.tsx',
      content: 'import Head from "next/head"; export default function Home() {}',
      state,
      confidenceReasons
    });

    expect(results.some((r) => r.ruleId === 'NEXT203')).toBe(true);
  });

  it('does nothing for non-next files', () => {
    const state = baseState();
    const results = runNextStructureChecks({
      file: 'src/index.ts',
      content: 'export const value = 1;',
      state,
      confidenceReasons
    });

    expect(results).toHaveLength(0);
  });
});
