#!/usr/bin/env node
/* eslint-disable */
/**
 * Auto-generates docs/RULES.md from the live rule registry built into
 * dist/rules/index.js. Run `npm run build && npm run rules:gen`.
 *
 * The buckets below are intentionally tied to the v3 scope (modern JS/TS web
 * stacks + cross-cutting concerns). Adding a new rule prefix? Either add a
 * dedicated bucket or it will fall through to "Security (JS/TS)".
 */
const fs = require('fs');
const path = require('path');

const modularRulesPath = path.join(__dirname, '..', 'dist', 'rules', 'index.js');
const legacyRulesPath = path.join(__dirname, '..', 'dist', 'types', 'rules.js');

let RULES = {};
if (fs.existsSync(modularRulesPath)) {
  ({ RULES } = require(modularRulesPath));
} else if (fs.existsSync(legacyRulesPath)) {
  ({ RULES } = require(legacyRulesPath));
} else {
  console.error('No rules found. Run `npm run build` first.');
  process.exit(1);
}

const NEXT_EXPERIMENTAL = new Set(['NEXT201', 'NEXT202', 'NEXT203', 'NEXT205', 'NEXT208', 'NEXT209']);

const MODERN_FRAMEWORK_PREFIXES = ['SVELTE', 'ASTRO', 'REMIX', 'HONO', 'DRIZZLE', 'PRISMA'];

const BUCKETS = [
  { title: 'Security (JS/TS)', match: (id) => id.startsWith('SEC') || id.startsWith('COOKIE') || id === 'JSNET001' || id === 'LOG001' || id === 'OSV001' },
  { title: 'AI (LLM era)', match: (id) => id.startsWith('AI') },
  { title: 'Next.js', match: (id) => id.startsWith('NEXT') && !NEXT_EXPERIMENTAL.has(id) },
  { title: 'Next.js (experimental)', match: (id) => NEXT_EXPERIMENTAL.has(id) },
  { title: 'Edge runtime', match: (id) => id.startsWith('EDGE') },
  { title: 'Modern frameworks (SvelteKit, Astro, Remix, Hono, Drizzle, Prisma)', match: (id) => MODERN_FRAMEWORK_PREFIXES.some((p) => id.startsWith(p)) },
  { title: 'Lovable / Supabase', match: (id) => id.startsWith('LOVABLE') },
  { title: 'Vite', match: (id) => id.startsWith('VITE') },
  { title: 'React / Tailwind', match: (id) => id.startsWith('TAILWIND') || id.startsWith('REACT') },
  { title: 'Vibe (AI hallucination signals)', match: (id) => id.startsWith('VIBE') },
  { title: 'Development hygiene', match: (id) => id.startsWith('DEV') },
  { title: 'Accessibility', match: (id) => id.startsWith('A11Y') },
  { title: 'Environment variables', match: (id) => id.startsWith('ENV') },
  { title: 'Links', match: (id) => id.startsWith('LINK') },
  { title: 'Docker / CI', match: (id) => id.startsWith('DOCKER') || id.startsWith('GHA') }
];

function bucketFor(id) {
  return BUCKETS.find((b) => b.match(id));
}

const grouped = new Map();
const orphan = [];

for (const id of Object.keys(RULES).sort()) {
  const meta = RULES[id];
  if (!meta) continue;
  const line = `- **${id}** — ${meta.message}${meta.helpUri ? ` ([docs](${meta.helpUri}))` : ''}`;
  const bucket = bucketFor(id);
  if (!bucket) {
    orphan.push(line);
    continue;
  }
  if (!grouped.has(bucket.title)) grouped.set(bucket.title, []);
  grouped.get(bucket.title).push(line);
}

let out = '# Rules Glossary\n\n';
out += 'This file is auto-generated from the rule registry by `scripts/generate-rules-md.js`.\n';
out += 'Do not hand-edit; run `npm run rules:gen` after building.\n\n';
out += `Total rules: **${Object.keys(RULES).length}**.\n`;

for (const bucket of BUCKETS) {
  const lines = grouped.get(bucket.title);
  if (!lines || lines.length === 0) continue;
  out += `\n## ${bucket.title}\n\n`;
  out += lines.join('\n') + '\n';
}

if (orphan.length > 0) {
  out += '\n## Other\n\n';
  out += orphan.join('\n') + '\n';
}

const target = path.join(__dirname, '..', 'docs', 'RULES.md');
fs.writeFileSync(target, out);
console.log(`docs/RULES.md regenerated (${Object.keys(RULES).length} rules across ${grouped.size} buckets).`);
