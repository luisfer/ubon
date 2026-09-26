import { realpathSync } from 'node:fs';
import { isAbsolute, relative, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { parseArgs } from 'node:util';
import type { IO } from '../cli/io.ts';
import { EXIT } from '../cli/main.ts';
import { safeText } from '../core/mask.ts';
import { toPosix } from '../core/files.ts';
import { repoRoot } from '../core/git.ts';
import { VERSION } from '../version.ts';
import { ToolInputError } from './errors.ts';
import { TOOLS, callTool } from './tools.ts';

/**
 * MCP server over stdio. Serves both protocol eras:
 *
 * - legacy (2025-11-25 and earlier): an `initialize` handshake, then requests;
 * - modern (2026-07-28): stateless requests that carry the protocol version
 *   and client capabilities in `_meta`, plus `server/discover`.
 *
 * All tools are read-only. Paths are confined to the workspace root. Results
 * are masked by the engine, and quoted code is labelled as data.
 */

export const MODERN_VERSIONS = ['2026-07-28'];
export const LEGACY_VERSIONS = ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05'];
const SUPPORTED = [...MODERN_VERSIONS, ...LEGACY_VERSIONS];

const META_VERSION = 'io.modelcontextprotocol/protocolVersion';
const META_CAPS = 'io.modelcontextprotocol/clientCapabilities';
const META_SERVER = 'io.modelcontextprotocol/serverInfo';

const SERVER_INFO = { name: 'ubon', title: 'Ubon', version: VERSION };
const INSTRUCTIONS =
  'Ubon checks code changes for leaked secrets, trust-boundary bugs, missing data access policies, risky packages, and weakened tests. Call `check` after changing code and before saying a task is done; call `vet` before installing a package; call `explain` for what a rule means and how to fix it; call `map` for an inventory of entry points to review. Every tool is read-only.';

interface JsonRpcRequest {
  jsonrpc: '2.0';
  id?: string | number | null;
  method?: string;
  params?: Record<string, unknown>;
}

type Reply = { result: unknown } | { error: { code: number; message: string; data?: unknown } };

export interface McpServerOptions {
  root: string;
}

export class McpServer {
  private legacyVersion: string | null = null;
  private readonly root: string;

  constructor(options: McpServerOptions) {
    this.root = options.root;
  }

  /** Handle one parsed message. Returns the response object, or null for notifications and responses. */
  async handle(message: unknown): Promise<Record<string, unknown> | null> {
    if (!message || typeof message !== 'object' || Array.isArray(message)) {
      return { jsonrpc: '2.0', id: null, error: { code: -32600, message: 'Invalid Request' } };
    }
    const req = message as JsonRpcRequest;
    if (typeof req.method !== 'string') return null; // a response from the client: nothing to do
    const isNotification = req.id === undefined;
    if (isNotification) return null; // notifications/initialized, notifications/cancelled, ...
    const reply = await this.dispatch(req.method, req.params ?? {});
    return { jsonrpc: '2.0', id: req.id ?? null, ...reply };
  }

  private async dispatch(method: string, params: Record<string, unknown>): Promise<Reply> {
    const meta = (params._meta ?? {}) as Record<string, unknown>;
    const requested = typeof meta[META_VERSION] === 'string' ? (meta[META_VERSION] as string) : null;

    if (method === 'initialize') {
      const asked = typeof params.protocolVersion === 'string' ? params.protocolVersion : '';
      const version = LEGACY_VERSIONS.includes(asked) ? asked : (LEGACY_VERSIONS[0] as string);
      this.legacyVersion = version;
      return {
        result: {
          protocolVersion: version,
          capabilities: { tools: { listChanged: false } },
          serverInfo: SERVER_INFO,
          instructions: INSTRUCTIONS,
        },
      };
    }

    let modern = false;
    if (requested !== null) {
      if (!MODERN_VERSIONS.includes(requested)) {
        if (LEGACY_VERSIONS.includes(requested) && this.legacyVersion) {
          // A legacy client that also sends _meta: keep serving the legacy session.
        } else {
          return { error: { code: -32022, message: 'Unsupported protocol version', data: { supported: SUPPORTED, requested } } };
        }
      } else {
        if (!meta[META_CAPS] || typeof meta[META_CAPS] !== 'object') {
          return { error: { code: -32602, message: `Invalid params: _meta["${META_CAPS}"] is required` } };
        }
        modern = true;
      }
    } else if (!this.legacyVersion && method !== 'ping') {
      return { error: { code: -32602, message: `Invalid params: _meta["${META_VERSION}"] is required, or send initialize first. Supported versions: ${SUPPORTED.join(', ')}` } };
    }

    const decorate = (result: Record<string, unknown>, cacheable: boolean): Reply => {
      if (!modern) return { result };
      return {
        result: {
          resultType: 'complete',
          ...result,
          ...(cacheable ? { ttlMs: 3_600_000, cacheScope: 'public' } : {}),
          _meta: { [META_SERVER]: SERVER_INFO },
        },
      };
    };

    switch (method) {
      case 'ping':
        return modern ? decorate({}, false) : { result: {} };
      case 'server/discover':
        if (!modern) return { error: { code: -32601, message: 'Method not found: server/discover needs a 2026-07-28 request' } };
        return decorate({ supportedVersions: SUPPORTED, capabilities: { tools: { listChanged: false } }, instructions: INSTRUCTIONS }, true);
      case 'tools/list':
        return decorate({ tools: TOOLS }, true);
      case 'tools/call': {
        const name = typeof params.name === 'string' ? params.name : '';
        const args = params.arguments && typeof params.arguments === 'object' ? (params.arguments as Record<string, unknown>) : {};
        if (!TOOLS.some((t) => t.name === name)) return { error: { code: -32602, message: `Unknown tool: ${safeText(name, 80)}` } };
        const result = await callTool(name, args, { root: this.root, resolvePath: (p) => this.confine(p) });
        return decorate(result as unknown as Record<string, unknown>, false);
      }
      case 'resources/list':
        return decorate({ resources: [] }, true);
      case 'prompts/list':
        return decorate({ prompts: [] }, true);
      default:
        return { error: { code: -32601, message: `Method not found: ${safeText(method, 80)}` } };
    }
  }

  /** Resolve a path argument inside the workspace root, or throw. */
  confine(input: string | undefined): string {
    if (!input) return this.root;
    const abs = isAbsolute(input) ? input : resolve(this.root, input);
    let real: string;
    try {
      real = realpathSync(abs);
    } catch {
      throw new ToolInputError(`No such path in the workspace: ${safeText(input, 120)}`);
    }
    const rootReal = realpathSync(this.root);
    const rel = relative(rootReal, real);
    if (rel.startsWith('..') || isAbsolute(rel)) throw new ToolInputError(`Path is outside the workspace (${toPosix(rootReal)}): ${safeText(input, 120)}`);
    return real;
  }
}

const HELP = `Usage: ubon mcp [--root <dir>]

Runs the Ubon MCP server over stdio. Tools: check, explain, map, vet (all
read-only). Paths are confined to the workspace root: --root, or the git
root of the directory the client starts the server in.
`;

export async function runMcp(argv: string[], io: IO): Promise<number> {
  const { values } = parseArgs({ args: argv, strict: true, options: { root: { type: 'string' }, help: { type: 'boolean', short: 'h' } } });
  if (values.help) {
    io.stdout(HELP);
    return EXIT.ok;
  }
  const start = values.root ? resolve(io.cwd, values.root) : io.cwd;
  const root = repoRoot(start) ?? start;
  const server = new McpServer({ root });
  const rl = createInterface({ input: process.stdin, crlfDelay: Number.POSITIVE_INFINITY });
  process.stderr.write(`ubon mcp ${VERSION}: serving ${root}\n`);
  let queue = Promise.resolve();
  for await (const line of rl) {
    if (!line.trim()) continue;
    if (line.length > 10 * 1024 * 1024) {
      process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32600, message: 'Message too large' } })}\n`);
      continue;
    }
    let message: unknown;
    try {
      message = JSON.parse(line);
    } catch {
      process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } })}\n`);
      continue;
    }
    // Process in order; a slow check does not reorder responses.
    queue = queue.then(async () => {
      try {
        const response = await server.handle(message);
        if (response) process.stdout.write(`${JSON.stringify(response)}\n`);
      } catch (error) {
        const id = (message as { id?: unknown })?.id ?? null;
        process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id, error: { code: -32603, message: `Internal error: ${safeText((error as Error).message, 200)}` } })}\n`);
      }
    });
  }
  await queue;
  return EXIT.ok;
}
