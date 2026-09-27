import type { Node } from '@babel/types';
import { SCRIPT_LANGS } from '../../core/files.ts';
import { ImportMap, boolValue, keyName, memberPath, stringValue, unwrap } from '../../lang/js.ts';
import { parseSource } from '../../lang/parse.ts';
import { walk } from '../../lang/walk.ts';
import { isPlaceholderValue, publicPrefixOf } from '../secret/names.ts';
import type { FileInfo, ProjectContext, Rule } from '../types.ts';
import { Bindings, envNamesIn, exampleLevel, isCall, lastSegment, templateShape } from '../web/pattern-ast.ts';

/**
 * LLM API keys that ship to the browser:
 *
 * - An SDK constructed with `dangerouslyAllowBrowser: true` (openai,
 *   @anthropic-ai/sdk, groq-sdk, and other Stainless-built SDKs) in a module
 *   that runs in the browser, with a key from a public env var or a literal.
 * - LLM SDKs created in browser code with such a key without the flag: SDKs
 *   that need no flag (Google GenAI, Mistral, Cohere, Hugging Face, AI SDK
 *   providers), and the flag SDKs, which refuse to run but still put the key
 *   in the bundle.
 * - Requests from browser code to an LLM API host (fetch, axios, or a wrapper
 *   taking a URL and fetch options) with an Authorization, x-api-key,
 *   api-key, or x-goog-api-key header (or Gemini's `?key=`) built from an env var.
 *
 * Keys are followed through same-file constants, `this.x` fields, and helpers
 * that return them (getApiKey()). A module that reads a key from VITE_,
 * REACT_APP_, EXPO_PUBLIC_, or GATSBY_ variables, or from window.ENV, is
 * browser code whatever its folder. This is the shape of apps that read
 * VITE_OPENAI_API_KEY in the browser. The flag in server code does nothing and
 * is reported as warn; keys a user types in (bring your own key) are not
 * reported, and neither is a proxy baseURL on the app's own server with a
 * dummy key. Example, sample, and demo folders are warn.
 */

const QUICK = /dangerouslyAllowBrowser|GoogleGenerativeAI|GoogleGenAI|@mistralai|cohere-ai|@huggingface\/inference|@ai-sdk\/|ai-sdk-provider|api\.openai\.com|api\.anthropic\.com|generativelanguage\.googleapis\.com|api\.groq\.com|api\.mistral\.ai|openrouter\.ai|api\.x\.ai|api\.deepseek\.com|api\.cohere\.|api\.together\.|api\.fireworks\.ai|api\.perplexity\.ai|huggingface\.co|api\.replicate\.com|api\.cerebras\.ai|openai\.azure\.com|integrate\.api\.nvidia\.com|api\.ai21\.com|api\.moonshot\.|dashscope\.aliyuncs\.com|api\.sambanova\.ai/;

const LLM_HOST = /^https?:\/\/(api\.openai\.com|api\.anthropic\.com|generativelanguage\.googleapis\.com|api\.groq\.com|api\.mistral\.ai|(api\.)?openrouter\.ai|api\.x\.ai|api\.deepseek\.com|api\.cohere\.(ai|com)|api\.together\.(xyz|ai)|api\.fireworks\.ai|api\.perplexity\.ai|(api-inference|router)\.huggingface\.co|api\.replicate\.com|api\.cerebras\.ai|[\w-]+\.openai\.azure\.com|integrate\.api\.nvidia\.com|api\.ai21\.com|api\.moonshot\.(ai|cn)|dashscope(-intl)?\.aliyuncs\.com|api\.sambanova\.ai)(\/|$|:)/i;

const AUTH_HEADER = /^(authorization|x-api-key|api-key|x-goog-api-key)$/i;

/** SDKs that need no flag to run in the browser: constructor or factory, and where the key goes. */
const FLAGLESS: Array<{ re: RegExp; name: string; key: 'arg0' | 'apiKey' | 'token' }> = [
  { re: /^@google\/generative-ai#GoogleGenerativeAI$/, name: 'GoogleGenerativeAI', key: 'arg0' },
  { re: /^@google\/genai#GoogleGenAI$/, name: 'GoogleGenAI', key: 'apiKey' },
  { re: /^@mistralai\/mistralai#Mistral$/, name: 'Mistral', key: 'apiKey' },
  { re: /^@mistralai\/mistralai#default$/, name: 'MistralClient', key: 'arg0' },
  { re: /^cohere-ai#CohereClient(V2)?$/, name: 'CohereClient', key: 'token' },
  { re: /^@huggingface\/inference#(HfInference|InferenceClient)$/, name: 'HfInference', key: 'arg0' },
  { re: /^(@ai-sdk\/[\w-]+|@openrouter\/ai-sdk-provider)#create\w+$/, name: '', key: 'apiKey' },
  // SDKs that need dangerouslyAllowBrowser refuse to run without it, but the key is in the bundle either way.
  { re: /^(openai#(default|OpenAI|AzureOpenAI)|@anthropic-ai\/sdk#(default|Anthropic)|groq-sdk#(default|Groq)|together-ai#(default|Together)|@cerebras\/cerebras_cloud_sdk#(default|Cerebras))$/, name: '', key: 'apiKey' },
];

type KeyKind = 'public-env' | 'server-env' | 'literal' | 'dummy' | 'missing' | 'other';

interface KeyInfo {
  kind: KeyKind;
  env?: string;
}

function classifyKey(node: Node | null | undefined, b: Bindings, parents: readonly Node[], ctx: ProjectContext, path: string): KeyInfo {
  if (!node) return { kind: 'missing' };
  const resolved = b.follow(node, parents);
  const envs = envNamesIn(resolved ?? node, b, parents);
  if (envs.length > 0) {
    const env = envs[0] as string;
    return isPublicEnv(env, ctx, path) ? { kind: 'public-env', env } : { kind: 'server-env', env };
  }
  const literal = stringValue(resolved);
  if (literal !== null) return isPlaceholderValue(literal) || literal.length < 16 ? { kind: 'dummy' } : { kind: 'literal' };
  return { kind: 'other' };
}

/** A variable the browser can read: a public prefix (VITE_, NEXT_PUBLIC_, ...), or runtime config the server writes into the page (window.ENV.X). */
function isPublicEnv(env: string, ctx: ProjectContext, path: string): boolean {
  return /^(window|globalThis|self)\./.test(env) || publicPrefixOf(env, ctx.project, path) !== null;
}

function prop(obj: Node | null | undefined, names: string[]): Node | null {
  const o = unwrap(obj);
  if (!o || o.type !== 'ObjectExpression') return null;
  for (const p of o.properties) if (p.type === 'ObjectProperty' && names.includes(keyName(p) ?? '')) return p.value as Node;
  return null;
}

/** A baseURL on the app's own server (relative, window.location) or a local model server. */
function proxyBase(value: Node | null, b: Bindings, parents: readonly Node[]): boolean {
  if (!value) return false;
  const v = b.follow(value, parents);
  const shape = templateShape(v);
  const text = shape?.text ?? '';
  if (/^\//.test(text) || /^https?:\/\/(localhost|127\.0\.0\.1|0\.0\.0\.0)(:|\/|$)/.test(text)) return true;
  const path = memberPath(v) ?? '';
  if (/^(window\.)?location\.origin$/.test(path)) return true;
  if (v?.type === 'TemplateLiteral' && v.expressions.some((e) => /location\.origin$/.test(memberPath(e as Node) ?? ''))) return true;
  if (v?.type === 'BinaryExpression' && /location\.origin$/.test(memberPath(v.left as Node) ?? '')) return true;
  return false;
}

/** The static text of a URL, with same-file string constants filled in: `${OPENAI_BASE}/chat/completions`. */
function urlShape(node: Node | null, b: Bindings, parents: readonly Node[]): { text: string } | null {
  const v = b.follow(node, parents);
  if (!v) return null;
  if (v.type === 'TemplateLiteral') {
    let text = '';
    v.quasis.forEach((q, i) => {
      text += q.value.cooked ?? q.value.raw;
      const e = v.expressions[i] as Node | undefined;
      if (!e) return;
      const resolved = stringValue(b.follow(e, parents));
      text += resolved ?? '\u0000';
    });
    return { text };
  }
  if (v.type === 'BinaryExpression' && v.operator === '+') {
    const left = urlShape(v.left as Node, b, parents)?.text ?? '\u0000';
    const right = urlShape(v.right, b, parents)?.text ?? '\u0000';
    return { text: left + right };
  }
  return templateShape(v);
}

function sdkName(canonical: string, callee: Node): string {
  const module = canonical.includes('#') ? canonical.slice(0, canonical.indexOf('#')) : '';
  const known: Record<string, string> = { openai: 'OpenAI', '@anthropic-ai/sdk': 'Anthropic', 'groq-sdk': 'Groq', 'together-ai': 'Together', '@cerebras/cerebras_cloud_sdk': 'Cerebras', 'xai-sdk': 'xAI' };
  const exported = canonical.slice(canonical.indexOf('#') + 1);
  if (exported && exported !== 'default' && exported !== '*') return exported;
  return known[module] ?? (lastSegment(memberPath(callee)) || 'the SDK');
}

function describeKey(k: KeyInfo): string {
  return k.kind === 'literal' ? 'a literal API key' : `the key from ${k.env}`;
}

/** Env prefixes that only a browser bundler inlines: a module that reads them for a key is browser code, whatever its folder (src/api/ in a Vite app). */
const BUNDLER_ONLY = /^(VITE_|REACT_APP_|EXPO_PUBLIC_|GATSBY_)/;

const FIX = 'Move the model call to a server route or Server Action that reads the key from a server-only env var, have the browser call that route, and rotate the exposed key.';

function checkFile(ctx: ProjectContext, path: string, info: FileInfo, text: string): void {
  const parsed = parseSource(text, info.lang);
  for (const block of parsed.blocks) {
    const imports = new ImportMap(block.program);
    const b = new Bindings(block.program.program);
    const blockLevel = exampleLevel(info);
    // Astro frontmatter runs on the server; its <script> tags run in the browser.
    const client = block.side === 'client' || (block.side !== 'server' && info.client);
    const server = block.side === 'server' || (!client && info.server);
    /** Where the key ends up: browser code by the module graph, or by the env prefix the key is read from. */
    const inBrowser = (key: KeyInfo) => client || (block.side !== 'server' && !!key.env && BUNDLER_ONLY.test(key.env)) || (!server && key.kind === 'public-env');
    walk(block.program.program, {
      enter(node, parents) {
        const isNew = node.type === 'NewExpression';
        if (!isNew && !isCall(node)) return undefined;
        const callee = (node as { callee: Node }).callee;
        const args = (node as { arguments: Node[] }).arguments;
        const canonical = imports.canonical(callee) ?? '';
        const line = node.loc?.start.line ?? 1;

        // 1. dangerouslyAllowBrowser: true
        const options = args.map((a) => b.follow(a, parents)).find((a) => a?.type === 'ObjectExpression') ?? null;
        const flag = prop(options, ['dangerouslyAllowBrowser']);
        if (flag && boolValue(flag) === true) {
          const name = `${isNew ? 'new ' : ''}${sdkName(canonical, callee)}()`;
          const keyNode = prop(options, ['apiKey']);
          const key = classifyKey(keyNode, b, parents, ctx, path);
          const keyLine = keyNode?.loc?.start.line ?? line;
          const proxy = proxyBase(prop(options, ['baseURL', 'baseUrl']), b, parents);
          const exposed = key.kind === 'public-env' || key.kind === 'literal';
          const browser = inBrowser(key);
          if (server && !browser) {
            ctx.report(path, { line, level: 'warn', message: `${name} sets dangerouslyAllowBrowser: true in server code, where it has no effect; it usually comes from code copied from a browser app.`, fix: 'Remove dangerouslyAllowBrowser from server code.', key: 'server-flag' });
            return undefined;
          }
          if (exposed && !proxy && (browser || key.kind === 'literal')) {
            ctx.report(path, { line: keyLine, level: blockLevel, message: `${name} runs in the browser with dangerouslyAllowBrowser: true and ${describeKey(key)}, so every visitor can read the key from the ${key.env?.startsWith('window.') ? 'page' : 'bundle'}.`, fix: FIX, key: key.env ?? 'literal' });
            return undefined;
          }
          if (key.kind === 'dummy' && proxy) return undefined; // the browser talks to the app's own proxy
          if (key.kind === 'other') return undefined; // a key the user types in (bring your own key)
          if (browser || !server) {
            const detail = key.kind === 'server-env' ? `; ${key.env} is undefined in the browser, and adding a public prefix to it would publish the key` : exposed && proxy ? ' and a key that ships in the bundle' : '';
            ctx.report(path, { line, level: 'warn', message: `${name} is created with dangerouslyAllowBrowser: true${detail}.`, fix: FIX, key: 'flag' });
          }
          return undefined;
        }

        // 2. SDKs that run in the browser without a flag.
        const sdk = FLAGLESS.find((f) => f.re.test(canonical));
        if (sdk) {
          const keyNode = sdk.key === 'arg0' ? (args[0] ?? null) : prop(b.follow(args[0], parents), [sdk.key]);
          const key = classifyKey(keyNode, b, parents, ctx, path);
          const keyLine = keyNode?.loc?.start.line ?? line;
          const baseProxy = proxyBase(prop(b.follow(args[0], parents), ['baseURL', 'baseUrl']), b, parents);
          if (inBrowser(key) && (key.kind === 'public-env' || key.kind === 'literal') && !baseProxy) {
            const name = `${isNew ? 'new ' : ''}${sdk.name || sdkName(canonical, callee)}()`;
            ctx.report(path, { line: keyLine, level: blockLevel, message: `${name} is ${isNew ? 'created' : 'called'} in browser code with ${describeKey(key)}, so every visitor can read the key from the ${key.env?.startsWith('window.') ? 'page' : 'bundle'}.`, fix: FIX, key: key.env ?? 'literal' });
          }
          return undefined;
        }

        // 3. Direct requests to an LLM API with an auth header built from an env var.
        if (isNew) return undefined;
        const path2 = memberPath(callee) ?? '';
        let urlNode: Node | null = null;
        let configNode: Node | null = null;
        if (path2 === 'fetch' || path2 === 'window.fetch' || path2 === 'ky' || /^(ofetch|\$fetch)$/.test(path2)) {
          urlNode = args[0] ?? null;
          configNode = args[1] ?? null;
        } else if (/^axios\.(post|put|patch)$/.test(canonical.replace(/^axios#/, 'axios.')) || /^axios\.(post|put|patch)$/.test(path2)) {
          urlNode = args[0] ?? null;
          configNode = args[2] ?? null;
        } else if (/^axios(\.(get|delete|request))?$/.test(path2) || canonical === 'axios#default' || canonical === 'axios#create' || path2 === 'axios.create') {
          const first = unwrap(args[0]);
          if (first?.type === 'ObjectExpression') {
            urlNode = prop(first, ['url', 'baseURL']);
            configNode = first;
          } else {
            urlNode = args[0] ?? null;
            configNode = args[1] ?? null;
          }
        } else if (args.length >= 2 && prop(b.follow(args[1], parents), ['headers'])) {
          // A wrapper around fetch: fetchWithTimeout(OPENAI_URL, { headers: { Authorization: ... } })
          urlNode = args[0] ?? null;
          configNode = args[1] ?? null;
        } else return undefined;
        const url = urlShape(urlNode, b, parents);
        const urlText = url?.text.replace(/\u0000/g, '') ?? '';
        if (!LLM_HOST.test(urlText)) return undefined;
        const host = /^https?:\/\/([^/:?]+)/.exec(urlText)?.[1] ?? 'an LLM API';
        const headers = b.follow(prop(b.follow(configNode, parents), ['headers']), parents);
        const headerObject = headers?.type === 'NewExpression' && memberPath(headers.callee) === 'Headers' ? unwrap(headers.arguments[0] as Node) : headers;
        let envName: string | null = null;
        let where = '';
        let atLine = line;
        if (headerObject?.type === 'ObjectExpression') {
          for (const p of headerObject.properties) {
            if (p.type !== 'ObjectProperty' || !AUTH_HEADER.test(keyName(p) ?? '')) continue;
            const envs = envNamesIn(p.value as Node, b, parents);
            if (envs.length > 0) {
              envName = envs[0] as string;
              where = `${/^([aeiou]|x-)/i.test(keyName(p) ?? '') ? 'an' : 'a'} ${keyName(p)} header`;
              atLine = p.loc?.start.line ?? line;
              break;
            }
          }
        }
        // Gemini: ?key=${import.meta.env.VITE_GEMINI_API_KEY}
        const rawUrl = b.follow(urlNode, parents);
        if (!envName && rawUrl?.type === 'TemplateLiteral' && /[?&]key=\u0000/.test(url?.text ?? '')) {
          const envs = envNamesIn(rawUrl, b, parents);
          if (envs.length > 0) {
            envName = envs[0] as string;
            where = 'a key= query parameter';
            atLine = urlNode?.loc?.start.line ?? line;
          }
        }
        if (!envName) return undefined;
        const isPublic = isPublicEnv(envName, ctx, path);
        if (!inBrowser({ kind: isPublic ? 'public-env' : 'server-env', env: envName })) return undefined;
        const fn = `${path2 || 'fetch'}()`;
        if (isPublic) {
          ctx.report(path, { line: atLine, level: blockLevel, message: `${fn} calls ${host} from browser code with ${where} built from ${envName}, so every visitor can read the key from the ${envName.startsWith('window.') ? 'page' : 'bundle'}.`, fix: FIX, key: envName });
        } else {
          ctx.report(path, { line: atLine, level: 'warn', message: `${fn} calls ${host} from browser code with ${where} built from ${envName}, which is undefined in the browser; adding a public prefix to it would publish the key.`, fix: FIX, key: envName });
        }
        return undefined;
      },
    });
  }
}

export const browserKey: Rule = {
  meta: {
    id: 'llm/browser-key',
    level: 'block',
    scope: 'project',
    title: 'LLM API key in browser code',
    summary: 'An LLM SDK or a direct request to an LLM API in code that runs in the browser, with a key from a public env var (VITE_, NEXT_PUBLIC_, ...) or a literal, including SDKs created with dangerouslyAllowBrowser: true.',
    why: 'Everything in the browser bundle is public: anyone who opens the site can copy the key from the JavaScript and run up usage on your account. This is the most common leak in AI-built apps that call OpenAI or Gemini straight from the browser.',
    fix: 'Move the model call to a server route or Server Action that reads the key from a server-only env var, and have the browser call that route.',
    owasp: ['LLM02:2025', 'LLM10:2025', 'A04:2025'],
    cwe: ['CWE-200', 'CWE-522', 'CWE-798'],
    levels: 'block for a key from a public env var or a literal in browser code; warn for dangerouslyAllowBrowser: true in server code (it has no effect there) and in browser code whose key is missing or undefined in the browser; warn in example, sample, and demo folders.',
  },
  project(ctx) {
    for (const view of ctx.scopeFiles) {
      if (view.status === 'deleted') continue;
      const info = ctx.info(view.path);
      if (!SCRIPT_LANGS.has(info.lang) || info.generated || info.contexts.has('test') || info.contexts.has('docs')) continue;
      const text = ctx.read(view.path);
      if (!text || !QUICK.test(text)) continue;
      checkFile(ctx, view.path, info, text);
    }
  },
};
