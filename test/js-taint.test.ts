import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Node } from '@babel/types';
import { ImportMap, type Taint, TaintTracker, hostFixed, joinedToUnknown, redirectPrefixSafe, walkWithTaint } from '../src/lang/js.ts';
import { parseSource } from '../src/lang/parse.ts';

/**
 * The taint tracker on small programs. Each `sink(x)` call records the taints
 * that reach its first argument at that point of the traversal.
 */

function sinks(code: string, options: { routeFile?: boolean } = {}): Taint[][] {
  const parsed = parseSource(code, 'tsx');
  const block = parsed.blocks[0];
  assert.ok(block, 'parsed');
  const imports = new ImportMap(block.program);
  const tracker = new TaintTracker(imports, { serverActionsModule: /^\s*['"]use server['"]/.test(code), routeFile: options.routeFile ?? false });
  const out: Taint[][] = [];
  walkWithTaint(block.program, tracker, {
    enter(node: Node) {
      if (node.type === 'CallExpression' && node.callee.type === 'Identifier' && node.callee.name === 'sink') out.push(tracker.taintsOf(node.arguments[0] as Node));
    },
  });
  return out;
}

const kinds = (list: Taint[] | undefined) => (list ?? []).map((t) => t.kind);
const sources = (list: Taint[] | undefined) => (list ?? []).map((t) => t.source);

test('route handler bodies and query strings', () => {
  const [body, query, clean] = sinks(`
    export async function POST(request: Request) {
      const { url, count } = await request.json();
      const { searchParams } = new URL(request.url);
      const next = searchParams.get('next');
      sink(url);
      sink(next);
      sink(Number(count) > 3 ? 'a' : 'b');
    }
  `);
  assert.deepEqual(sources(body), ['the request body']);
  assert.deepEqual(sources(query), ['the query string']);
  assert.equal(query?.[0]?.ownUrl, undefined);
  assert.deepEqual(clean, []);
});

test('Express, Hono, and Next.js sources', () => {
  const [express, hono, nextHeaders, host] = sinks(`
    import { headers } from 'next/headers';
    app.post('/run', (req, res) => { sink(req.body.cmd); });
    app.get('/x', async (c) => { sink(c.req.query('q')); });
    export async function GET() {
      const h = await headers();
      sink(h.get('x-user'));
      sink(h.get('host'));
    }
  `);
  assert.deepEqual(sources(express), ['the request body']);
  assert.deepEqual(sources(hono), ['the query string']);
  assert.deepEqual(sources(nextHeaders), ['request headers']);
  assert.equal(host?.[0]?.ownUrl, true);
});

test('URLs keep track of what fixes the origin', () => {
  const [ownBase, relative, fixedHost, envBase, taintedHost, concat, noSlash] = sinks(`
    export async function GET(request: Request) {
      const { searchParams } = new URL(request.url);
      const q = searchParams.get('q');
      sink(new URL('/login', request.url));
      sink(new URL(\`/search?q=\${q}\`, request.url));
      sink(\`https://api.example.com/items/\${q}\`);
      sink(\`\${process.env.API_URL}/items/\${q}\`);
      sink(\`https://\${q}/items\`);
      sink(API_BASE + '/users/' + q);
      sink(\`\${API_BASE}\${q}\`);
    }
  `);
  assert.deepEqual(ownBase, []);
  assert.equal(relative?.[0]?.pathOnly, true);
  assert.equal(fixedHost?.[0]?.pathOnly, true);
  assert.equal(envBase?.[0]?.pathOnly, true);
  assert.equal(taintedHost?.[0]?.pathOnly, false);
  assert.equal(concat?.[0]?.pathOnly, true);
  assert.equal(noSlash?.[0]?.pathOnly, false);
});

test('prefix helpers', () => {
  assert.equal(hostFixed('https://api.example.com/'), true);
  assert.equal(hostFixed('https://api.example.com'), false);
  assert.equal(hostFixed('\u0000/v1/'), true);
  assert.equal(hostFixed('\u0001/v1/'), true);
  assert.equal(redirectPrefixSafe('/dashboard/'), true);
  assert.equal(redirectPrefixSafe('/'), false);
  // An unknown value is a non-empty segment; a value that may be empty (env, ?? '') is not.
  assert.equal(redirectPrefixSafe('\u0000/'), true);
  assert.equal(redirectPrefixSafe('\u0001/'), false);
  assert.equal(redirectPrefixSafe('\u0000'), false);
  assert.equal(redirectPrefixSafe('\u0000/login?next='), true);
  assert.equal(redirectPrefixSafe('?tab='), true);
  assert.equal(joinedToUnknown('\u0000'), true);
  assert.equal(joinedToUnknown('\u0000/'), false);
});

test('URL parts: module constants are read, env reads may be empty', () => {
  const [constBase, envBase, joined] = sinks(`
    const FAVICONS = 'https://www.google.com/s2/favicons?domain=';
    app.get('/x', (req, res) => {
      sink(\`\${FAVICONS}\${req.query.domain}\`);
      sink(\`\${process.env.BASE_PATH ?? ''}/\${req.query.next}\`);
      sink(\`\${config.base}\${req.query.path}\`);
    });
  `);
  assert.equal(constBase?.[0]?.pathOnly, true);
  assert.equal(envBase?.[0]?.prefix, '\u0001/');
  assert.equal(joinedToUnknown(joined?.[0]?.prefix), true);
});

test('casts, placeholders, and unknown functions end the flow', () => {
  const [cast, placeholders, unknown, joined, sanitized] = sinks(`
    app.get('/items', (req, res) => {
      const ids = req.query.ids.split(',');
      sink(parseInt(req.query.page, 10));
      sink(ids.map(() => '?').join(','));
      sink(lookup(req.query.name));
      sink(ids.map(Number).join(','));
      sink(DOMPurify.sanitize(req.body.html));
    });
  `);
  assert.deepEqual(cast?.[0]?.via, ['number']);
  assert.deepEqual(placeholders, []);
  assert.deepEqual(unknown, []);
  assert.ok(joined?.[0]?.via.includes('number'));
  assert.ok(sanitized?.[0]?.via.includes('html-sanitizer'));
});

test('conditional values carry every branch', () => {
  const [both] = sinks(`
    app.post('/x', (req, res) => {
      const html = req.body.trusted ? DOMPurify.sanitize(req.body.html) : req.body.html;
      sink(html);
    });
  `);
  assert.equal(both?.length, 2);
  assert.ok(both?.some((t) => t.via.length === 0));
});

test('tool arguments have their own kind and follow the input schema', () => {
  const [command, mode, city] = sinks(`
    import { tool } from 'ai';
    import { z } from 'zod';
    export const run = tool({
      description: 'Run a command',
      inputSchema: z.object({ command: z.string(), mode: z.enum(['fast', 'slow']) }),
      execute: async ({ command, mode }) => { sink(command); sink(mode); },
    });
    const Weather = z.object({ city: z.string().describe('City') });
    export const weather = tool({ description: 'w', inputSchema: Weather, execute: async (input) => { sink(input.city); } });
  `);
  assert.deepEqual(kinds(command), ['tool']);
  assert.deepEqual(command?.[0]?.via, []);
  assert.deepEqual(mode, []);
  assert.deepEqual(kinds(city), ['tool']);
});

test('MCP tool handlers', () => {
  const [path, level, lowLevel] = sinks(`
    import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
    const server = new McpServer({ name: 'x', version: '1' });
    server.tool('read', 'Read a file', { path: z.string(), level: z.number() }, async ({ path, level }) => { sink(path); sink(level); });
    server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;
      sink(args.url);
    });
  `);
  assert.deepEqual(kinds(path), ['tool']);
  assert.deepEqual(level, []);
  assert.deepEqual(kinds(lowLevel), ['tool']);
});

test('model output from SDK calls', () => {
  const [text, openai, anthropic, twilio, streamed] = sinks(`
    import { generateText, streamText } from 'ai';
    import Anthropic from '@anthropic-ai/sdk';
    export async function POST(req: Request) {
      const { text } = await generateText({ model, prompt: 'x' });
      sink(text);
      const completion = await openai.chat.completions.create({ model: 'gpt', messages: [] });
      sink(completion.choices[0].message.content);
      const msg = await anthropic.messages.create({ model: 'claude', max_tokens: 10, messages: [] });
      sink(msg.content[0].text);
      const sms = await twilioClient.calls.create({ to: '1' });
      sink(sms.sid);
      const result = streamText({ model, prompt: 'x' });
      let html = '';
      for await (const delta of result.textStream) html += delta;
      sink(html);
    }
  `);
  assert.deepEqual(kinds(text), ['model']);
  assert.deepEqual(kinds(openai), ['model']);
  assert.deepEqual(kinds(anthropic), ['model']);
  assert.deepEqual(twilio, []);
  assert.deepEqual(kinds(streamed), ['model']);
});

test('messages.create is model output only with an Anthropic client', () => {
  const [mail] = sinks(`
    import twilio from 'twilio';
    export async function POST() {
      const m = await client.messages.create({ body: 'hi', to: '1' });
      sink(m.body);
    }
  `);
  assert.deepEqual(mail, []);
});

test('generateObject fields follow the schema', () => {
  const [category, sql] = sinks(`
    import { generateObject } from 'ai';
    export async function POST() {
      const { object } = await generateObject({ model, schema: z.object({ category: z.enum(['a', 'b']), sql: z.string() }), prompt: 'x' });
      sink(object.category);
      sink(object.sql);
    }
  `);
  assert.deepEqual(category, []);
  assert.deepEqual(kinds(sql), ['model']);
  assert.ok(!sql?.[0]?.via.includes('schema'));
});

test('schema parses: known fields are classified, unknown schemas are marked', () => {
  const [id, name, imported] = sinks(`
    import { z } from 'zod';
    import { OtherSchema } from './schemas';
    const Body = z.object({ id: z.coerce.number(), name: z.string().min(1) });
    export async function POST(request: Request) {
      const body = Body.parse(await request.json());
      sink(body.id);
      sink(body.name);
      const other = OtherSchema.parse(await request.json());
      sink(other.name);
    }
  `);
  assert.deepEqual(id, []);
  assert.deepEqual(name?.[0]?.via, []);
  assert.deepEqual(imported?.[0]?.via, ['schema']);
});

test('iteration callbacks see the elements', () => {
  const [item, entry] = sinks(`
    app.post('/batch', (req, res) => {
      req.body.items.forEach((item) => sink(item.path));
      for (const file of req.files) sink(file.originalname);
    });
  `);
  assert.deepEqual(sources(item), ['the request body']);
  assert.deepEqual(sources(entry), ['an uploaded file']);
});

test('Server Actions, tRPC, h3, and NestJS arguments', () => {
  const action = sinks(`'use server';
    export async function save(formData: FormData) { sink(formData.get('url')); }
  `);
  assert.deepEqual(sources(action[0]), ['a Server Action argument']);

  const [trpcName, trpcId] = sinks(`
    export const r = router({
      byName: publicProcedure.input(z.object({ name: z.string(), id: z.number() })).query(({ input }) => { sink(input.name); sink(input.id); }),
    });
  `);
  assert.deepEqual(sources(trpcName), ['tRPC input']);
  assert.deepEqual(trpcId, []);

  const [h3] = sinks(`
    export default defineEventHandler(async (event) => { const body = await readBody(event); sink(body.path); });
  `);
  assert.deepEqual(sources(h3), ['the request body']);

  const [nestBody, nestId] = sinks(`
    class Files {
      @Post() create(@Body() body: any, @Param('id', ParseIntPipe) id: number) { sink(body.path); sink(id); }
    }
  `);
  assert.deepEqual(sources(nestBody), ['the request body']);
  assert.deepEqual(nestId, []);
});

test('chat hooks: messages are model output, input is not', () => {
  const [messages, input, part] = sinks(`
    import { useChat } from '@ai-sdk/react';
    export function Chat() {
      const { messages, input } = useChat();
      sink(messages);
      sink(input);
      messages.map((m) => sink(m.content));
    }
  `);
  assert.deepEqual(kinds(messages), ['model']);
  assert.deepEqual(input, []);
  assert.deepEqual(kinds(part), ['model']);
});

test('assigned properties and reassignments', () => {
  const [prop, other, sanitized] = sinks(`
    app.post('/x', (req, res) => {
      const opts = { method: 'GET' };
      opts.url = req.body.url;
      sink(opts.url);
      sink(opts.method);
      let name = req.params.name;
      name = path.basename(name);
      sink(name);
    });
  `);
  assert.deepEqual(sources(prop), ['the request body']);
  assert.deepEqual(other, []);
  assert.ok(sanitized?.[0]?.via.includes('basename'));
});

test('page props and browser sources', () => {
  const [page, browser, clientQuery, clientRoute] = sinks(`
    export default async function Page({ searchParams }) {
      const { q } = await searchParams;
      sink(q);
    }
    function f() { sink(location.hash.slice(1)); }
    function C() { const sp = useSearchParams(); sink(sp.get('next')); }
    function D() { const { slug } = useParams(); sink(slug); }
  `);
  assert.deepEqual(sources(page), ['the query string']);
  assert.deepEqual(sources(browser), ['the page URL']);
  assert.deepEqual(sources(clientQuery), ['the query string']);
  assert.deepEqual(sources(clientRoute), ['route parameters']);
});

test('network responses are external', () => {
  const [json, text] = sinks(`
    export async function GET() {
      const res = await fetch('https://example.com/feed');
      const data = await res.json();
      sink(data.items);
      const page = await (await fetch(url)).text();
      sink(page);
    }
  `);
  assert.deepEqual(kinds(json), ['external']);
  assert.deepEqual(kinds(text), ['external']);
});
