/**
 * Path-based file contexts. Code-based contexts (client, server) come from
 * the project model because they depend on imports and directives.
 */

export type PathContext = 'test' | 'generated' | 'agent' | 'migration' | 'ci' | 'config' | 'docs' | 'example';

const TEST_DIR = /(^|\/)(__tests__|__mocks__|__fixtures__|test|tests|spec|specs|e2e|cypress|playwright|fixtures|testdata|test-data|mocks)(\/|$)/;
const TEST_FILE = /\.(test|spec|e2e|stories|story|bench)\.[cm]?[jt]sx?$/;
const TEST_CONFIG = /(^|\/)(jest|vitest|playwright|cypress|karma|ava)\.config\.[cm]?[jt]s$|(^|\/)(setupTests|test-setup)\.[jt]sx?$/;

const GENERATED_FILE = /(^|\/)(package-lock\.json|npm-shrinkwrap\.json|pnpm-lock\.yaml|yarn\.lock|bun\.lockb?|Cargo\.lock|poetry\.lock|composer\.lock|Gemfile\.lock)$|\.d\.[cm]?ts$|\.min\.(js|css)$|\.map$|\.snap$|(^|\/)(dist|build|out|\.next|\.nuxt|\.output|\.svelte-kit|coverage|vendor|generated|__generated__)\//;

const AGENT_FILE = new RegExp(
  [
    '(^|/)(AGENTS|CLAUDE|GEMINI|CLAUDE\\.local|AGENTS\\.override)\\.md$',
    '(^|/)SKILL\\.md$',
    '(^|/)\\.(claude|cursor|codex|gemini|agents|windsurf|kiro|devin|factory|roo|junie|opencode|amp|clinerules)(/|$)',
    '(^|/)\\.github/(copilot-instructions\\.md|instructions/|prompts/|hooks/|skills/|agents/|chatmodes/)',
    '(^|/)\\.(cursorrules|windsurfrules|clinerules|goosehints)$',
    '(^|/)\\.mcp\\.json$',
    '(^|/)\\.vscode/mcp\\.json$',
    '(^|/)\\.aider\\.conf\\.ya?ml$',
    '(^|/)(mcp|mcp_config|cline_mcp_settings)\\.json$',
  ].join('|'),
);

const MIGRATION_FILE = /(^|\/)supabase\/(migrations|schemas)\/[^/]+\.sql$|(^|\/)prisma\/migrations\/.+\.sql$|(^|\/)(drizzle|migrations|db\/migrations|database\/migrations)\/.*\.sql$|(^|\/)(firestore|storage)\.rules$|(^|\/)database\.rules\.json$/;

const CI_FILE = /(^|\/)\.github\/workflows\/[^/]+\.ya?ml$|(^|\/)\.gitlab-ci\.ya?ml$|(^|\/)\.circleci\/config\.ya?ml$|(^|\/)action\.ya?ml$/;

const CONFIG_FILE = /(^|\/)(package\.json|tsconfig[^/]*\.json|jsconfig\.json|(next|vite|nuxt|svelte|astro|remix|tailwind|postcss|webpack|rollup|babel|eslint|prettier|biome|turbo|vercel|netlify|wrangler)\.config\.[cm]?[jt]s|\.eslintrc[^/]*|\.prettierrc[^/]*|biome\.jsonc?|turbo\.json|vercel\.json|netlify\.toml|wrangler\.toml|wrangler\.jsonc?)$/;

const DOCS_FILE = /\.(md|mdx|markdown|rst|txt)$|(^|\/)(docs|documentation)\//;

const EXAMPLE_DIR = /(^|\/)(examples?|samples?|demo|demos|templates?)(\/|$)/;

export function pathContexts(path: string): Set<PathContext> {
  const out = new Set<PathContext>();
  if (TEST_DIR.test(path) || TEST_FILE.test(path) || TEST_CONFIG.test(path)) out.add('test');
  if (GENERATED_FILE.test(path)) out.add('generated');
  if (AGENT_FILE.test(path)) out.add('agent');
  if (MIGRATION_FILE.test(path)) out.add('migration');
  if (CI_FILE.test(path)) out.add('ci');
  if (CONFIG_FILE.test(path)) out.add('config');
  if (DOCS_FILE.test(path) && !out.has('agent')) out.add('docs');
  if (EXAMPLE_DIR.test(path)) out.add('example');
  return out;
}

export function hasGeneratedHeader(text: string): boolean {
  const head = text.slice(0, 600);
  return /@generated|DO NOT EDIT|auto-?generated|This file (?:is|was|has been) (?:automatically )?generated/i.test(head);
}

/** Server-only locations by framework convention. */
export const SERVER_PATH = /(^|\/)(app|src\/app)\/(.+\/)?route\.[cm]?[jt]sx?$|(^|\/)(pages|src\/pages)\/api\/|(^|\/)(middleware|proxy|instrumentation)\.[cm]?[jt]s$|\.server\.[cm]?[jt]sx?$|(^|\/)\+(server|page\.server|layout\.server)\.[cm]?[jt]s$|(^|\/)hooks\.server\.[cm]?[jt]s$|(^|\/)(src\/)?lib\/server\/|(^|\/)(server|api|backend|functions|netlify\/functions|supabase\/functions|workers?)\/|(^|\/)(src\/)?routes\/api\//;
