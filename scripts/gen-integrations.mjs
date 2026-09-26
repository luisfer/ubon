#!/usr/bin/env node
// Generates files that must match their source of truth:
//   hooks/hooks.json     Claude Code plugin hooks, from src/integrations/specs.ts
//   schema/config.json   JSON Schema for ubon.json, with the current rule IDs
// and version fields that must match package.json (plugin manifests, skill).
// Usage: node scripts/gen-integrations.mjs [--check]
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { join } from 'node:path';

const root = join(import.meta.dirname, '..');
const check = process.argv.includes('--check');
const { claudePluginHooks } = await import('../src/integrations/specs.ts');
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));

const outputs = new Map();
outputs.set('hooks/hooks.json', `${JSON.stringify(claudePluginHooks(), null, 2)}\n`);

const plugin = JSON.parse(readFileSync(join(root, '.claude-plugin/plugin.json'), 'utf8'));
plugin.version = pkg.version;
outputs.set('.claude-plugin/plugin.json', `${JSON.stringify(plugin, null, 2)}\n`);

const market = JSON.parse(readFileSync(join(root, '.claude-plugin/marketplace.json'), 'utf8'));
for (const p of market.plugins) {
  if (p.name !== 'ubon') continue;
  p.version = pkg.version;
  p.source.version = pkg.version;
}
outputs.set('.claude-plugin/marketplace.json', `${JSON.stringify(market, null, 2)}\n`);

const { RULES } = await import('../src/rules/index.ts');
const ids = RULES.map((r) => r.meta.id);
const packs = [...new Set(ids.map((id) => id.split('/')[0]))];
const stringList = { type: 'array', items: { type: 'string' } };
const configSchema = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: 'https://github.com/luisfer/ubon/blob/main/schema/config.json',
  title: 'ubon.json',
  description: 'Configuration for Ubon. Unknown keys are an error. See https://github.com/luisfer/ubon/blob/main/docs/config.md',
  type: 'object',
  additionalProperties: false,
  properties: {
    $schema: { type: 'string' },
    rules: {
      description: 'Rule levels by rule ID or pack selector (pack/*). An exact ID wins over a pack selector.',
      type: 'object',
      propertyNames: { anyOf: [{ enum: ids }, { enum: packs.map((p) => `${p}/*`) }] },
      additionalProperties: { enum: ['block', 'warn', 'off'] },
    },
    ignore: { ...stringList, description: 'Glob patterns of files Ubon does not check. A pattern without a slash matches at any depth, as in .gitignore.' },
    auth: {
      type: 'object',
      additionalProperties: false,
      properties: {
        functions: { ...stringList, description: 'Names of your own auth helpers (for example requireUser), so ubon map recognizes auth calls.' },
        public: { ...stringList, description: 'Glob patterns of entry point files that are public on purpose.' },
      },
    },
    packages: {
      type: 'object',
      additionalProperties: false,
      properties: {
        online: { type: 'boolean', default: false, description: 'Allow registry and OSV lookups for new packages.' },
        minAgeDays: { type: 'number', minimum: 0, default: 7, description: 'A new package must have existed for at least this many days.' },
        minReleaseAgeHours: { type: 'number', minimum: 0, default: 48, description: 'A new version must have been published at least this many hours ago.' },
        allow: { ...stringList, description: 'Package names or scopes (@acme/*) that skip package checks.' },
      },
    },
    commands: {
      type: 'object',
      additionalProperties: false,
      properties: {
        ask: { ...stringList, description: 'Command prefixes that need a person to approve them.' },
        deny: { ...stringList, description: 'Command prefixes that are always denied.' },
        allow: { ...stringList, description: 'Command prefixes that are always allowed (checked first).' },
      },
    },
    suppressions: {
      type: 'object',
      additionalProperties: false,
      properties: { agent: { enum: ['allow', 'human-only'], default: 'allow', description: 'human-only: a suppression added in an agent session blocks the stop hook until a person approves it.' } },
    },
    session: {
      type: 'object',
      additionalProperties: false,
      properties: { stop: { enum: ['block', 'warn'], default: 'block', description: 'block: the agent must fix blocking findings before it finishes.' } },
    },
    prompts: {
      type: 'object',
      additionalProperties: false,
      properties: { secrets: { enum: ['block', 'warn'], default: 'block', description: 'What to do with a prompt that contains a provider key.' } },
    },
    maxFileSize: { type: 'number', minimum: 0, default: 1048576, description: 'Files larger than this many bytes are not checked (and are listed as not checked).' },
  },
};
outputs.set('schema/config.json', `${JSON.stringify(configSchema, null, 2)}\n`);

const action = readFileSync(join(root, 'action.yml'), 'utf8').replace(/(  version:\n    description: [^\n]*\n    default: )\S+/, `$1${pkg.version}`);
outputs.set('action.yml', action);
const precommit = readFileSync(join(root, '.pre-commit-hooks.yaml'), 'utf8').replace(/ubon@[\w.-]+/g, `ubon@${pkg.version}`).replace(/rev: v[\w.-]+/, `rev: v${pkg.version}`);
outputs.set('.pre-commit-hooks.yaml', precommit);

const skillPath = 'skills/ubon/SKILL.md';
const skill = readFileSync(join(root, skillPath), 'utf8').replace(/ubon-version: "[^"]*"/, `ubon-version: "${pkg.version}"`);
outputs.set(skillPath, skill);

let stale = 0;
for (const [file, content] of outputs) {
  let current = null;
  try {
    current = readFileSync(join(root, file), 'utf8');
  } catch {
    // missing
  }
  if (current === content) continue;
  if (check) {
    console.error(`${file} is out of date; run npm run gen`);
    stale++;
  } else {
    mkdirSync(dirname(join(root, file)), { recursive: true });
    writeFileSync(join(root, file), content);
    console.log(`wrote ${file}`);
  }
}
process.exit(stale ? 1 : 0);
