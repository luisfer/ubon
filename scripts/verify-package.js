#!/usr/bin/env node
/* eslint-disable no-console */

const { execFileSync } = require('node:child_process');

const REQUIRED_FILES = [
  'dist/cli.js',
  'dist/index.js',
  'dist/index.d.ts',
  'README.md',
  'LICENSE',
  'CHANGELOG.md',
  'MIGRATION-v3.md',
  'docs/CLI.md',
  'docs/RULES.md',
  'docs/CONFIG.md',
  'docs/INTEGRATIONS.md',
  'docs/MCP.md',
  'docs/ADVANCED.md',
  'docs/START-HERE.md',
  'docs/AGENT-HARNESS.md',
  'docs/AGENT-SEMANTICS.md',
  'docs/PROGRAMMATIC.md',
  'docs/RELEASE.md',
  'docs/VALIDATION.md',
  'docs/schema/ubon-finding.schema.json',
  'package.json'
];

function main() {
  const raw = execFileSync('npm', ['pack', '--json', '--dry-run'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'inherit']
  });
  const payload = JSON.parse(raw);
  const files = new Set((payload[0]?.files || []).map((file) => file.path));
  const missing = REQUIRED_FILES.filter((file) => !files.has(file));

  if (missing.length > 0) {
    console.error('Package dry-run is missing required files:');
    for (const file of missing) console.error(`- ${file}`);
    process.exit(1);
  }

  console.log(`Package dry-run includes ${files.size} files and all required public artifacts.`);
}

main();
