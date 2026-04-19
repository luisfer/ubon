import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { AIScanner } from '../scanners/ai-scanner';

/**
 * Fixture-based integration tests for the AI001–AI008 rule pack. Each test
 * builds a tiny project layout under os.tmpdir() and asserts the scanner
 * emits the expected ruleId. Stays fast (one scanner, < 5 files per case)
 * but exercises the full file-walk + rule pipeline.
 */
describe('AIScanner integration', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'ubon-ai-scanner-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  const writeFile = (rel: string, content: string) => {
    const full = join(dir, rel);
    mkdirSync(join(full, '..'), { recursive: true });
    writeFileSync(full, content);
  };

  it('flags MCP server config with hardcoded secret (AI005)', async () => {
    writeFile(
      '.cursor/mcp.json',
      JSON.stringify({
        mcpServers: {
          example: {
            command: 'npx',
            args: ['-y', 'mcp-example'],
            env: { OPENAI_API_KEY: 'sk-' + 'a'.repeat(40) },
          },
        },
      })
    );
    const scanner = new AIScanner();
    const results = await scanner.scan({ directory: dir, verbose: false } as any);
    const ai005 = results.filter((r) => r.ruleId === 'AI005');
    expect(ai005.length).toBeGreaterThan(0);
  });

  it('flags unauthenticated streaming endpoint (AI007)', async () => {
    writeFile(
      'app/api/chat/route.ts',
      `import { streamText } from 'ai';
import { openai } from '@ai-sdk/openai';

export async function POST(req: Request) {
  const { messages } = await req.json();
  const result = await streamText({ model: openai('gpt-4o'), messages });
  return result.toDataStreamResponse();
}
`
    );
    const scanner = new AIScanner();
    const results = await scanner.scan({ directory: dir, verbose: false } as any);
    const ai007 = results.filter((r) => r.ruleId === 'AI007');
    expect(ai007.length).toBeGreaterThan(0);
  });

  it('does not flag streaming endpoint when auth and rate limit are present', async () => {
    writeFile(
      'app/api/chat/route.ts',
      `import { streamText } from 'ai';
import { openai } from '@ai-sdk/openai';
import { auth } from '@/auth';
import { ratelimit } from '@/lib/ratelimit';

export async function POST(req: Request) {
  const session = await auth();
  if (!session) return new Response('unauthorized', { status: 401 });
  await ratelimit.limit(session.user.id);
  const { messages } = await req.json();
  const result = await streamText({ model: openai('gpt-4o'), messages });
  return result.toDataStreamResponse();
}
`
    );
    const scanner = new AIScanner();
    const results = await scanner.scan({ directory: dir, verbose: false } as any);
    const ai007 = results.filter((r) => r.ruleId === 'AI007');
    expect(ai007.length).toBe(0);
  });
});
