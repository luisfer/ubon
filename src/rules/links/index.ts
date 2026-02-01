import { Rule, RuleMeta } from '../types';

const makeRule = (meta: RuleMeta): Rule => ({
  meta,
  impl: {
    fileTypes: ['md', 'mdx', 'js', 'jsx', 'ts', 'tsx', 'html']
  }
});

export const linksRules: Record<string, Rule> = {
  LINK001: makeRule({
    id: 'LINK001',
    category: 'links',
    severity: 'low',
    message: 'Link checking requires puppeteer installation',
    fix: 'Install with: npm install puppeteer'
  }),
  LINK002: makeRule({
    id: 'LINK002',
    category: 'links',
    severity: 'medium',
    message: 'External link unreachable or 4xx/5xx',
    fix: 'Update URL or ensure target is reachable'
  }),
  LINK003: makeRule({
    id: 'LINK003',
    category: 'links',
    severity: 'medium',
    message: 'Internal link or resource broken',
    fix: 'Fix route or asset; check server logs'
  }),
  NEXT001: makeRule({
    id: 'NEXT001',
    category: 'links',
    severity: 'low',
    message: 'next/link used without anchor or child text (legacyBehavior)',
    fix: 'Wrap link content with <a> or set proper child'
  }),
  NEXT002: makeRule({
    id: 'NEXT002',
    category: 'links',
    severity: 'medium',
    message: 'In-page <a> used for client navigation; prefer next/link',
    fix: 'Use <Link href=\"...\"><a>…</a></Link> or modern API'
  }),
  NEXT201: makeRule({
    id: 'NEXT201',
    category: 'links',
    severity: 'low',
    message: 'Missing 404/not-found page',
    fix: 'Add pages/404.tsx (Pages Router) or app/not-found.tsx (App Router)',
    helpUri: 'https://nextjs.org/docs/app/api-reference/file-conventions/not-found',
    impact: 'Improves UX and SEO by handling missing routes gracefully'
  }),
  NEXT202: makeRule({
    id: 'NEXT202',
    category: 'links',
    severity: 'low',
    message: 'Missing error boundary page',
    fix: 'Add pages/_error.tsx (Pages Router) or app/error.tsx (App Router)',
    helpUri: 'https://nextjs.org/docs/app/building-your-application/routing/error-handling',
    impact: 'Prevents blank screens and surfaces friendly errors to users'
  }),
  NEXT203: makeRule({
    id: 'NEXT203',
    category: 'links',
    severity: 'low',
    message: 'Missing _document.tsx while using next/head or next/script',
    fix: 'Add pages/_document.tsx when customizing <Head> or <Script> in Pages Router',
    helpUri: 'https://nextjs.org/docs/pages/building-your-application/routing/custom-document',
    impact: 'Ensures consistent <html>/<body> structure and script handling in Pages Router'
  })
};
