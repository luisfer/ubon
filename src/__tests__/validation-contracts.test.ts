import { existsSync, readFileSync, rmSync } from 'fs';
import { spawnSync } from 'child_process';
import { join, resolve } from 'path';
import { MCP_TEST_HANDLERS } from '../mcp/server';

const CLI = join(process.cwd(), 'dist', 'cli.js');
const hasDist = existsSync(CLI);
const fixtureDir = resolve(process.cwd(), 'examples', 'ai-harness-demo');

function runCli(args: string[]) {
  return spawnSync('node', [CLI, ...args], { encoding: 'utf8' });
}

function parseToolResult(result: Awaited<ReturnType<(typeof MCP_TEST_HANDLERS)[string]>>) {
  return JSON.parse(result.content[0].text);
}

describe('Validation contracts for agents and CI', () => {
  (hasDist ? it : it.skip)('emits JSON with source context for agent preset', () => {
    const res = runCli(['check', '-d', fixtureDir, '--preset', 'agent', '--no-result-cache']);
    expect(res.status === 0 || res.status === 1).toBe(true);
    const payload = JSON.parse(res.stdout);
    expect(payload.schemaVersion).toBe('2.0.0');
    expect(payload.summary.total).toBeGreaterThan(0);
    const issue = payload.issues.find((finding: any) => finding.ruleId === 'SEC030');
    expect(issue.context.line).toContain('fetch');
    expect(issue.range.startLine).toBe(issue.line);
    expect(issue.fix).toBeTruthy();
    expect(issue.confidenceReason).toBeTruthy();
  });

  (hasDist ? it : it.skip)('emits parseable NDJSON and PR review output', () => {
    const ndjson = runCli(['check', '-d', fixtureDir, '--ndjson', '--quiet', '--no-result-cache']);
    expect(ndjson.status === 0 || ndjson.status === 1).toBe(true);
    const lines = ndjson.stdout.trim().split('\n').filter(Boolean);
    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines) expect(() => JSON.parse(line)).not.toThrow();

    const review = runCli([
      'review',
      '-d',
      fixtureDir,
      '--since',
      'HEAD',
      '--changed-files',
      'app/api/chat/route.ts',
      '.cursor/hooks.json',
      '.cursor/commands/deploy.md',
      '--no-result-cache'
    ]);
    expect(review.status === 0 || review.status === 1).toBe(true);
    expect(review.stdout).toContain('# Ubon Findings');
  });

  (hasDist ? it : it.skip)('prints deterministic rule catalog JSON', () => {
    const first = runCli(['rules', 'list', '--json']);
    const second = runCli(['rules', 'list', '--json']);
    expect(first.status).toBe(0);
    expect(first.stdout).toBe(second.stdout);
    const rules = JSON.parse(first.stdout);
    expect(rules.some((rule: any) => rule.id === 'CC009')).toBe(true);
    expect(rules.some((rule: any) => rule.id === 'AI007')).toBe(true);
  });

  (hasDist ? it : it.skip)('writes SARIF for fixture findings', () => {
    const sarifPath = join(process.cwd(), '.tmp-validation-contracts.sarif');
    const res = runCli(['check', '-d', fixtureDir, '--json', '--sarif', sarifPath, '--no-result-cache']);
    expect(res.status === 0 || res.status === 1).toBe(true);
    const sarif = JSON.parse(readFileSync(sarifPath, 'utf-8'));
    expect(sarif.version).toBe('2.1.0');
    expect(sarif.runs[0].results.length).toBeGreaterThan(0);
    rmSync(sarifPath, { force: true });
  });

  it('exposes MCP scan, verify, plan, rule catalog, and status contracts', async () => {
    const check = parseToolResult(await MCP_TEST_HANDLERS['ubon.check']({
      directory: fixtureDir,
      minConfidence: 0.7,
      showContext: true
    }));
    expect(check.schemaVersion).toBe('2.0.0');
    expect(check.issues.some((issue: any) => issue.context?.line)).toBe(true);

    const verify = parseToolResult(await MCP_TEST_HANDLERS['ubon.verify']({
      directory: fixtureDir,
      minConfidence: 0.7,
      failOn: 'none'
    }));
    expect(verify.ok).toBe(true);
    expect(verify.summary.total).toBeGreaterThan(0);

    const plan = parseToolResult(await MCP_TEST_HANDLERS['ubon.plan-fixes']({
      directory: fixtureDir
    }));
    expect(plan.steps.some((step: any) => step.ruleId === 'CC009' && step.autofixable)).toBe(true);
    expect(plan.steps.some((step: any) => step.file && step.fix)).toBe(true);

    const catalog = parseToolResult(await MCP_TEST_HANDLERS['ubon.rule-catalog']({}));
    expect(catalog.rules.some((rule: any) => rule.id === 'SEC030')).toBe(true);

    const status = parseToolResult(await MCP_TEST_HANDLERS['ubon.status']({ directory: fixtureDir }));
    expect(status.directory).toBe(fixtureDir);
    expect(status.harness.cursorHooks).toBe(true);
    expect(status.ruleCount).toBeGreaterThan(0);
  }, 20000);
});
