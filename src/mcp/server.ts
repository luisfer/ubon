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

import { resolve } from 'path';
import { UbonScan } from '..';
import { RULES, getRule } from '../rules';
import { applyFixes, previewFixes } from '../utils/fix';
import { ScanOptions } from '../types';

interface ToolHandlerArgs {
  directory?: string;
  profile?: string;
  fast?: boolean;
  ruleId?: string;
  apply?: boolean;
  minConfidence?: number;
}

interface ToolHandlerResult {
  content: Array<{ type: 'text'; text: string }>;
}

function resolveDirectory(input?: string): string {
  return resolve(input || process.cwd());
}

function buildScanOptions(args: ToolHandlerArgs): ScanOptions {
  return {
    directory: resolveDirectory(args.directory),
    profile: (args.profile as ScanOptions['profile']) || 'auto',
    fast: !!args.fast,
    skipBuild: true,
    minConfidence: typeof args.minConfidence === 'number' ? args.minConfidence : undefined
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
    issues: results
  };
  return { content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }] };
}

async function runExplain(args: ToolHandlerArgs): Promise<ToolHandlerResult> {
  const id = args.ruleId;
  if (!id) {
    return {
      content: [{ type: 'text', text: JSON.stringify({ error: 'missing ruleId' }) }]
    };
  }
  const rule = getRule(id);
  if (!rule) {
    return {
      content: [
        { type: 'text', text: JSON.stringify({ error: `unknown rule ${id}`, knownRules: Object.keys(RULES).slice(0, 50) }) }
      ]
    };
  }
  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify(
          {
            id: rule.meta.id,
            category: rule.meta.category,
            severity: rule.meta.severity,
            message: rule.meta.message,
            fix: rule.meta.fix,
            impact: rule.meta.impact,
            helpUri: rule.meta.helpUri
          },
          null,
          2
        )
      }
    ]
  };
}

async function runPreviewFixes(args: ToolHandlerArgs): Promise<ToolHandlerResult> {
  const scanner = new UbonScan(false, true);
  const options = buildScanOptions(args);
  const results = await scanner.diagnose(options);
  const previews = previewFixes(results, options.directory);
  return { content: [{ type: 'text', text: JSON.stringify({ previews }, null, 2) }] };
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
        text: JSON.stringify({ dryRun, changedFiles, appliedEditCount }, null, 2)
      }
    ]
  };
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
        minConfidence: { type: 'number', minimum: 0, maximum: 1 }
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
        minConfidence: { type: 'number', minimum: 0, maximum: 1 }
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
  }
];

export async function startMcpServer(): Promise<void> {
  // Dynamic import to keep the SDK truly optional.
  let McpServer: any;
  let StdioServerTransport: any;
  try {
    const sdkPkg = '@modelcontextprotocol/sdk';
    const serverMod: any = await import(`${sdkPkg}/server/index.js`);
    const stdioMod: any = await import(`${sdkPkg}/server/stdio.js`);
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
  const sdkPkg = '@modelcontextprotocol/sdk';
  const typesMod: any = await import(`${sdkPkg}/types.js`);

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
