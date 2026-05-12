#!/usr/bin/env node
/* eslint-disable no-console */

const { cpSync, mkdtempSync, rmSync, writeFileSync, readFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join, resolve } = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');

const command = process.env.UBON_AGENT_EVAL_COMMAND;

if (!command) {
  console.log('Skipping live agent eval: set UBON_AGENT_EVAL_COMMAND to opt in.');
  process.exit(0);
}

const root = resolve(__dirname, '..');
const cli = join(root, 'dist', 'cli.js');
const tempParent = mkdtempSync(join(tmpdir(), 'ubon-agent-eval-'));
const fixture = join(tempParent, 'ai-harness-demo');
const report = join(tempParent, 'ubon-report.json');

try {
  cpSync(join(root, 'examples', 'ai-harness-demo'), fixture, { recursive: true });
  const initial = execFileSync('node', [
    cli,
    'check',
    '-d',
    fixture,
    '--preset',
    'agent',
    '--no-result-cache',
    '--fail-on',
    'none'
  ], { encoding: 'utf8' });
  writeFileSync(report, initial);

  const result = spawnSync(command, {
    shell: true,
    stdio: 'inherit',
    env: {
      ...process.env,
      UBON_AGENT_EVAL_FIXTURE: fixture,
      UBON_AGENT_EVAL_REPORT: report
    }
  });

  if (result.status !== 0) {
    console.error(`Agent eval command exited with ${result.status}.`);
    process.exit(result.status || 1);
  }

  const after = execFileSync('node', [
    cli,
    'check',
    '-d',
    fixture,
    '--json',
    '--quiet',
    '--no-result-cache',
    '--fail-on',
    'none'
  ], { encoding: 'utf8' });
  const payload = JSON.parse(after);
  const active = payload.issues.filter((issue) => !issue.suppressed);
  console.log(`Live agent eval complete: ${active.length} active findings remain.`);
  console.log(JSON.stringify({
    fixture,
    remaining: active.map((issue) => ({
      ruleId: issue.ruleId,
      file: issue.file,
      line: issue.line,
      severity: issue.severity
    }))
  }, null, 2));

  // Touch the report so shell users can inspect both before and after.
  writeFileSync(join(tempParent, 'ubon-after.json'), after);
  readFileSync(report, 'utf8');
} finally {
  if (process.env.UBON_KEEP_AGENT_EVAL !== '1') {
    rmSync(tempParent, { recursive: true, force: true });
  } else {
    console.log(`Kept eval temp directory: ${tempParent}`);
  }
}
