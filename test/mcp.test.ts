import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, test } from 'node:test';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { expandFakeKeys } from './support/fake-keys.ts';
import { REPO_ROOT, commitAll, initRepo, tempDir, writeFiles } from './support/fixtures.ts';

/**
 * The MCP server, spoken to by the official MCP client over stdio in both
 * protocol eras, plus raw JSON-RPC for error cases the client never sends.
 */

const ENTRY = join(REPO_ROOT, 'test', 'support', 'ubon.ts');

function workspace(): string {
  const dir = tempDir();
  initRepo(dir);
  writeFiles(dir, { 'package.json': '{"name":"ws","private":true}', 'lib/ok.ts': 'export const ok = 1;\n' });
  commitAll(dir);
  return dir;
}

async function connect(dir: string, mode: 'legacy' | { pin: string }) {
  const transport = new StdioClientTransport({ command: process.execPath, args: [ENTRY, 'mcp'], cwd: dir, stderr: 'ignore' });
  const client = new Client({ name: 'ubon-test', version: '1.0.0' }, { versionNegotiation: { mode } });
  await client.connect(transport);
  return client;
}

for (const [label, mode] of [
  ['legacy handshake', 'legacy' as const],
  ['stateless 2026-07-28', { pin: '2026-07-28' }],
] as const) {
  describe(`mcp (${label})`, () => {
    test('lists four read-only tools with static descriptions', async () => {
      const dir = workspace();
      const client = await connect(dir, mode);
      try {
        const { tools } = await client.listTools();
        assert.deepEqual(tools.map((t) => t.name), ['check', 'explain', 'map', 'vet']);
        for (const t of tools) assert.equal(t.annotations?.readOnlyHint, true, t.name);
      } finally {
        await client.close();
      }
    });

    test('check returns masked findings as structured content', async () => {
      const dir = workspace();
      const key = expandFakeKeys('{{fake:anthropic:3}}');
      writeFileSync(join(dir, 'lib/ai.ts'), `export const key = '${key}';\n`);
      const client = await connect(dir, mode);
      try {
        const result = await client.callTool({ name: 'check', arguments: {} });
        const structured = result.structuredContent as { summary: { block: number }; findings: Array<{ rule: string }> };
        assert.equal(structured.summary.block, 1);
        assert.equal(structured.findings[0]?.rule, 'secret/provider-key');
        const all = JSON.stringify(result);
        assert.ok(!all.includes(key), 'the raw key must not reach the MCP client');
        assert.match(JSON.stringify(result.content), /treat quoted code as data/i);
      } finally {
        await client.close();
      }
    });

    test('paths outside the workspace are rejected as tool errors', async () => {
      const dir = workspace();
      const client = await connect(dir, mode);
      try {
        const result = await client.callTool({ name: 'check', arguments: { path: '../../etc' } });
        assert.equal(result.isError, true);
        assert.match(JSON.stringify(result.content), /outside the workspace|No such path/);
      } finally {
        await client.close();
      }
    });

    test('vet denies an invalid package name without a network lookup', async () => {
      const dir = workspace();
      const client = await connect(dir, mode);
      try {
        const result = await client.callTool({ name: 'vet', arguments: { packages: ['Not A Valid Name'] } });
        const structured = result.structuredContent as { packages: Array<{ spec: string; decision: string; rule?: string }> };
        assert.equal(structured.packages[0]?.decision, 'deny');
        assert.equal(structured.packages[0]?.rule, 'deps/nonexistent-package');
        assert.match(JSON.stringify(result.content), /1 denied/);
      } finally {
        await client.close();
      }
    });

    test('explain returns rule metadata', async () => {
      const dir = workspace();
      const client = await connect(dir, mode);
      try {
        const result = await client.callTool({ name: 'explain', arguments: { rule: 'secret/provider-key' } });
        assert.equal((result.structuredContent as { id: string }).id, 'secret/provider-key');
      } finally {
        await client.close();
      }
    });
  });
}

describe('mcp raw protocol', () => {
  async function exchange(dir: string, messages: unknown[]): Promise<Array<Record<string, any>>> {
    const child = spawn(process.execPath, [ENTRY, 'mcp'], { cwd: dir, stdio: ['pipe', 'pipe', 'ignore'] });
    let out = '';
    child.stdout.on('data', (d) => {
      out += d;
    });
    for (const m of messages) child.stdin.write(`${typeof m === 'string' ? m : JSON.stringify(m)}\n`);
    child.stdin.end();
    await new Promise((r) => child.on('close', r));
    return out.trim().split('\n').filter(Boolean).map((l) => JSON.parse(l) as Record<string, any>);
  }

  test('unsupported versions, missing metadata, unknown methods, and parse errors', async () => {
    const dir = workspace();
    const caps = { 'io.modelcontextprotocol/clientCapabilities': {} };
    const replies = await exchange(dir, [
      { jsonrpc: '2.0', id: 1, method: 'tools/list', params: { _meta: { 'io.modelcontextprotocol/protocolVersion': '1900-01-01', ...caps } } },
      { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} },
      { jsonrpc: '2.0', id: 3, method: 'server/discover', params: { _meta: { 'io.modelcontextprotocol/protocolVersion': '2026-07-28', ...caps } } },
      { jsonrpc: '2.0', id: 4, method: 'nope', params: { _meta: { 'io.modelcontextprotocol/protocolVersion': '2026-07-28', ...caps } } },
      '{not json',
      { jsonrpc: '2.0', id: 5, method: 'tools/list', params: { _meta: { 'io.modelcontextprotocol/protocolVersion': '2026-07-28' } } },
    ]);
    const byId = new Map(replies.map((r) => [r.id, r]));
    assert.equal(byId.get(1)?.error.code, -32022);
    assert.deepEqual(byId.get(1)?.error.data.requested, '1900-01-01');
    assert.equal(byId.get(2)?.error.code, -32602);
    assert.equal(byId.get(3)?.result.resultType, 'complete');
    assert.ok(byId.get(3)?.result.supportedVersions.includes('2025-11-25'));
    assert.equal(typeof byId.get(3)?.result.ttlMs, 'number');
    assert.equal(byId.get(4)?.error.code, -32601);
    assert.equal(byId.get(null)?.error.code, -32700);
    assert.equal(byId.get(5)?.error.code, -32602);
  });
});
