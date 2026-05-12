/**
 * Ubon MCP server.
 *
 * Exposes the Ubon scanner over the Model Context Protocol so AI assistants
 * (Cursor, Claude Desktop, Windsurf, Cline, OpenAI Apps) can call:
 *
 *   ubon.scan           — run a full scan and return the v2.0.0 JSON report
 *   ubon.check          — alias for scan with skipBuild=true (cheap loop)
 *   ubon.explain        — return rule metadata + remediation hints
 *   ubon.preview-fixes  — return file-level diffs for auto-fixable findings
 *   ubon.apply-fixes    — write the auto-fixes to disk (gated by `--apply`)
 *
 * The `@modelcontextprotocol/sdk` is an *optional* dependency. We import it
 * dynamically and degrade gracefully if it isn't installed, so users who
 * never touch MCP don't carry the extra weight.
 */

import { existsSync, readFileSync } from 'fs';
import { join, resolve } from 'path';
import { UbonScan } from '..';
import { RULES, getRule } from '../rules';
import { applyFixes, previewFixes } from '../utils/fix';
import { getChangedFilesSince } from '../utils/git';
import { buildIssueContext } from '../utils/issue-context';
import { ScanOptions } from '../types';

interface ToolHandlerArgs {
  directory?: string;
  profile?: string;
  fast?: boolean;
  ruleId?: string;
  apply?: boolean;
  minConfidence?: number;
  changedFiles?: string[];
  gitChangedSince?: string;
  baseSha?: string;
  enabledRules?: string[];
  disabledRules?: string[];
  baseline?: string;
  focusNew?: boolean;
  focusSecurity?: boolean;
  focusCritical?: boolean;
  failOn?: 'none' | 'warning' | 'error';
  showContext?: boolean;
  explain?: boolean;
}

interface ToolHandlerResult {
  content: Array<{ type: 'text'; text: string }>;
}

function resolveDirectory(input?: string): string {
  return resolve(input || process.cwd());
}

function stableStringify(value: unknown, indent: number = 2): string {
  const replacer = (_key: string, v: unknown) => {
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      return Object.keys(v as object)
        .sort()
        .reduce<Record<string, unknown>>((acc, k) => {
          acc[k] = (v as Record<string, unknown>)[k];
          return acc;
        }, {});
    }
    return v;
  };
  return JSON.stringify(value, replacer, indent);
}

function json(payload: unknown): ToolHandlerResult {
  return { content: [{ type: 'text', text: stableStringify(payload, 2) }] };
}

function buildScanOptions(args: ToolHandlerArgs): ScanOptions {
  const directory = resolveDirectory(args.directory);
  const changedFiles = args.changedFiles && args.changedFiles.length > 0
    ? args.changedFiles
    : (args.gitChangedSince || args.baseSha)
      ? getChangedFilesSince((args.gitChangedSince || args.baseSha) as string, directory)
      : undefined;
  return {
    directory,
    profile: (args.profile as ScanOptions['profile']) || 'auto',
    fast: !!args.fast,
    skipBuild: true,
    minConfidence: typeof args.minConfidence === 'number' ? args.minConfidence : undefined,
    changedFiles,
    gitChangedSince: args.gitChangedSince || args.baseSha,
    enabledRules: args.enabledRules,
    disabledRules: args.disabledRules,
    baselinePath: args.baseline,
    focusNew: !!args.focusNew,
    focusSecurity: !!args.focusSecurity,
    focusCritical: !!args.focusCritical,
    showContext: !!args.showContext,
    explain: !!args.explain,
    quiet: true
  };
}

async function runScan(args: ToolHandlerArgs): Promise<ToolHandlerResult> {
  const scanner = new UbonScan(false, true);
  const options = buildScanOptions(args);
  const results = await scanner.diagnose(options);
  const payload = {
    schemaVersion: '2.0.0',
    toolVersion: require('../../package.json').version,
    summary: {
      total: results.length,
      errors: results.filter((r) => r.type === 'error').length,
      warnings: results.filter((r) => r.type === 'warning').length,
      info: results.filter((r) => r.type === 'info').length
    },
    issues: results.map((result) => ({
      ...result,
      context: args.showContext ? buildIssueContext(options.directory, result.file, result.line) : undefined
    }))
  };
  return json(payload);
}

async function runExplain(args: ToolHandlerArgs): Promise<ToolHandlerResult> {
  const id = args.ruleId;
  if (!id) {
    return {
      content: [{ type: 'text', text: stableStringify({ error: 'missing ruleId' }) }]
    };
  }
  const rule = getRule(id);
  if (!rule) {
    return {
      content: [
        { type: 'text', text: stableStringify({ error: `unknown rule ${id}`, knownRules: Object.keys(RULES).sort() }) }
      ]
    };
  }
  return {
    content: [
      {
        type: 'text',
        text: stableStringify({
          id: rule.meta.id,
          category: rule.meta.category,
          severity: rule.meta.severity,
          message: rule.meta.message,
          fix: rule.meta.fix,
          impact: rule.meta.impact,
          helpUri: rule.meta.helpUri
        })
      }
    ]
  };
}

async function runPreviewFixes(args: ToolHandlerArgs): Promise<ToolHandlerResult> {
  const scanner = new UbonScan(false, true);
  const options = buildScanOptions(args);
  const results = await scanner.diagnose(options);
  const previews = previewFixes(results, options.directory);
  return json({ previews });
}

async function runApplyFixes(args: ToolHandlerArgs): Promise<ToolHandlerResult> {
  const scanner = new UbonScan(false, true);
  const options = buildScanOptions(args);
  const results = await scanner.diagnose(options);
  // `apply: false` keeps this tool safe by default — clients must opt in.
  const dryRun = args.apply !== true;
  const { changedFiles, appliedEditCount } = applyFixes(results, options.directory, dryRun);
  return {
    content: [
      {
        type: 'text',
        text: stableStringify({ dryRun, changedFiles, appliedEditCount })
      }
    ]
  };
}

async function runPlanFixes(args: ToolHandlerArgs): Promise<ToolHandlerResult> {
  const scanner = new UbonScan(false, true);
  const options = buildScanOptions({ ...args, fast: true });
  const results = await scanner.diagnose(options);
  const steps = results
    .filter((result) => result.fix)
    .map((result) => ({
      ruleId: result.ruleId,
      severity: result.severity,
      confidence: result.confidence,
      file: result.file,
      line: result.line,
      fix: result.fix,
      autofixable: !!result.fixEdits?.length
    }));
  return json({ steps });
}

async function runStatus(args: ToolHandlerArgs): Promise<ToolHandlerResult> {
  const directory = resolveDirectory(args.directory);
  return json({
    directory,
    toolVersion: require('../../package.json').version,
    config: {
      json: existsSync(join(directory, 'ubon.config.json')),
      js: existsSync(join(directory, 'ubon.config.js')),
      packageJson: existsSync(join(directory, 'package.json'))
    },
    harness: {
      cursorHooks: existsSync(join(directory, '.cursor', 'hooks.json')),
      cursorRule: existsSync(join(directory, '.cursor', 'rules', 'ubon.mdc')),
      agentsMd: existsSync(join(directory, 'AGENTS.md')),
      claudeMd: existsSync(join(directory, 'CLAUDE.md')),
      preCommit: existsSync(join(directory, '.pre-commit-config.yaml')),
      githubWorkflow: existsSync(join(directory, '.github', 'workflows', 'ubon.yml')),
      baseline: existsSync(join(directory, '.ubon.baseline.json')),
      cacheIgnored: existsSync(join(directory, '.gitignore')) &&
        readFileSync(join(directory, '.gitignore'), 'utf-8').split(/\r?\n/).includes('.ubon/')
    },
    ruleCount: Object.keys(RULES).length
  });
}

async function runRuleCatalog(): Promise<ToolHandlerResult> {
  return json({
    rules: Object.values(RULES)
      .map((rule) => ({
        id: rule.id,
        category: rule.category,
        severity: rule.severity,
        message: rule.message,
        fix: rule.fix,
        helpUri: rule.helpUri
      }))
      .sort((a, b) => a.id.localeCompare(b.id))
  });
}

async function runVerify(args: ToolHandlerArgs): Promise<ToolHandlerResult> {
  const scanner = new UbonScan(false, true);
  const options = buildScanOptions({ ...args, fast: true, focusCritical: args.focusCritical ?? true });
  const results = await scanner.diagnose(options);
  const errors = results.filter((r) => r.type === 'error').length;
  const warnings = results.filter((r) => r.type === 'warning').length;
  const failOn = args.failOn || 'error';
  const ok = failOn === 'none' || (failOn === 'error' ? errors === 0 : errors + warnings === 0);
  return json({
    ok,
    failOn,
    summary: {
      total: results.length,
      errors,
      warnings,
      info: results.filter((r) => r.type === 'info').length
    },
    issues: results
  });
}

const TOOLS = [
  {
    name: 'ubon.scan',
    description:
      'Run a full Ubon scan on the given directory. Returns the v2.0.0 JSON report (use the schema at docs/schema/ubon-finding.schema.json).',
    inputSchema: {
      type: 'object',
      properties: {
        directory: { type: 'string', description: 'Absolute path to scan (defaults to CWD).' },
        profile: { type: 'string', enum: ['auto', 'lovable', 'react', 'next', 'sveltekit', 'astro', 'remix', 'hono'] },
        fast: { type: 'boolean', description: 'Skip OSV / link checks for a faster loop.' },
        minConfidence: { type: 'number', minimum: 0, maximum: 1 },
        changedFiles: { type: 'array', items: { type: 'string' } },
        gitChangedSince: { type: 'string' },
        baseSha: { type: 'string' },
        enabledRules: { type: 'array', items: { type: 'string' } },
        disabledRules: { type: 'array', items: { type: 'string' } },
        baseline: { type: 'string' },
        focusNew: { type: 'boolean' },
        focusSecurity: { type: 'boolean' },
        focusCritical: { type: 'boolean' },
        showContext: { type: 'boolean' },
        explain: { type: 'boolean' }
      }
    },
    handler: runScan
  },
  {
    name: 'ubon.check',
    description: 'Cheap static-analysis-only scan. Same shape as ubon.scan.',
    inputSchema: {
      type: 'object',
      properties: {
        directory: { type: 'string' },
        profile: { type: 'string' },
        minConfidence: { type: 'number', minimum: 0, maximum: 1 },
        changedFiles: { type: 'array', items: { type: 'string' } },
        gitChangedSince: { type: 'string' },
        baseSha: { type: 'string' },
        enabledRules: { type: 'array', items: { type: 'string' } },
        disabledRules: { type: 'array', items: { type: 'string' } },
        focusSecurity: { type: 'boolean' },
        focusCritical: { type: 'boolean' },
        showContext: { type: 'boolean' },
        explain: { type: 'boolean' }
      }
    },
    handler: (args: ToolHandlerArgs) => runScan({ ...args, fast: true })
  },
  {
    name: 'ubon.explain',
    description: 'Return metadata for a rule (severity, fix, impact, helpUri).',
    inputSchema: {
      type: 'object',
      properties: { ruleId: { type: 'string' } },
      required: ['ruleId']
    },
    handler: runExplain
  },
  {
    name: 'ubon.preview-fixes',
    description: 'Return file-level diffs for auto-fixable findings without writing to disk.',
    inputSchema: {
      type: 'object',
      properties: {
        directory: { type: 'string' },
        profile: { type: 'string' }
      }
    },
    handler: runPreviewFixes
  },
  {
    name: 'ubon.apply-fixes',
    description:
      'Apply auto-fixes. Defaults to dry-run; pass `apply: true` to write changes to disk.',
    inputSchema: {
      type: 'object',
      properties: {
        directory: { type: 'string' },
        profile: { type: 'string' },
        apply: { type: 'boolean' }
      }
    },
    handler: runApplyFixes
  },
  {
    name: 'ubon.plan-fixes',
    description: 'Return ordered fix steps for current findings without writing to disk.',
    inputSchema: {
      type: 'object',
      properties: {
        directory: { type: 'string' },
        profile: { type: 'string' },
        changedFiles: { type: 'array', items: { type: 'string' } },
        gitChangedSince: { type: 'string' },
        baseSha: { type: 'string' }
      }
    },
    handler: runPlanFixes
  },
  {
    name: 'ubon.status',
    description: 'Return Ubon config and agent-harness status for the project.',
    inputSchema: {
      type: 'object',
      properties: {
        directory: { type: 'string' }
      }
    },
    handler: runStatus
  },
  {
    name: 'ubon.rule-catalog',
    description: 'Return the machine-readable rule catalog.',
    inputSchema: {
      type: 'object',
      properties: {}
    },
    handler: runRuleCatalog
  },
  {
    name: 'ubon.verify',
    description: 'Run a compact deterministic verification gate for agents and hooks.',
    inputSchema: {
      type: 'object',
      properties: {
        directory: { type: 'string' },
        profile: { type: 'string' },
        changedFiles: { type: 'array', items: { type: 'string' } },
        gitChangedSince: { type: 'string' },
        baseSha: { type: 'string' },
        failOn: { type: 'string', enum: ['none', 'warning', 'error'] },
        focusCritical: { type: 'boolean' }
      }
    },
    handler: runVerify
  }
];

export const MCP_TEST_HANDLERS = Object.fromEntries(
  TOOLS.map((tool) => [tool.name, tool.handler])
) as Record<string, (args: ToolHandlerArgs) => Promise<ToolHandlerResult>>;

export async function startMcpServer(): Promise<void> {
  // Dynamic import to keep the SDK truly optional.
  let McpServer: any;
  let StdioServerTransport: any;
  try {
    const serverMod: any = await import('@modelcontextprotocol/sdk/server/index.js');
    const stdioMod: any = await import('@modelcontextprotocol/sdk/server/stdio.js');
    McpServer = serverMod.Server;
    StdioServerTransport = stdioMod.StdioServerTransport;
  } catch (err) {
    process.stderr.write(
      '🪷 ubon mcp: the optional dependency `@modelcontextprotocol/sdk` is not installed.\n' +
        '   It ships as an optionalDependency of `ubon`, so this only happens if your\n' +
        '   install skipped optional deps (`npm install --no-optional`, container images,\n' +
        '   some lockfile tooling). Install it manually:\n' +
        '     npm install -g @modelcontextprotocol/sdk\n' +
        '   See docs/MCP.md for details.\n'
    );
    process.exit(1);
  }

  const server = new McpServer(
    {
      name: 'ubon',
      version: require('../../package.json').version
    },
    {
      capabilities: { tools: {} }
    }
  );

  // Register tool list + dispatcher. The SDK exposes both `setRequestHandler`
  // and a higher-level helper depending on version; we use the request-handler
  // form for maximum portability across SDK minor versions.
  const typesMod: any = await import('@modelcontextprotocol/sdk/types.js');

  server.setRequestHandler(typesMod.ListToolsRequestSchema, async () => ({
    tools: TOOLS.map(({ name, description, inputSchema }) => ({ name, description, inputSchema }))
  }));

  server.setRequestHandler(typesMod.CallToolRequestSchema, async (request: any) => {
    const tool = TOOLS.find((t) => t.name === request.params.name);
    if (!tool) {
      return {
        content: [{ type: 'text', text: JSON.stringify({ error: `unknown tool ${request.params.name}` }) }],
        isError: true
      };
    }
    try {
      return await tool.handler(request.params.arguments || {});
    } catch (err: any) {
      return {
        content: [{ type: 'text', text: JSON.stringify({ error: err?.message || String(err) }) }],
        isError: true
      };
    }
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
  process.stderr.write('🪷 ubon mcp: connected over stdio\n');
}
