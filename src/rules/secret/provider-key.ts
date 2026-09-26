import { maskValue } from '../../core/mask.ts';
import { lineStarts, offsetToPosition } from '../../core/files.ts';
import { JWT_PATTERN, SECRET_FORMATS, type SecretFormat, decodeJwtPayload, isPlaceholderSecret } from '../../data/secrets.ts';
import type { FileInfo, Rule, TextContext } from '../types.ts';
import { isEnvFileName } from './names.ts';

/**
 * Literal credentials in a known provider format, in any text file.
 * Evidence and messages only ever contain the masked value.
 */

const QUICK = /sk-|gsk_|xai-|r8_|hf_|pcsk_|AIza|AKIA|ASIA|ABIA|ACCA|secret_?access_?key|gh[pousr]_|github_pat_|glpat-|_live_|_test_|whsec_|xox[baprse]-|hooks\.slack\.com|SG\.|re_|npm_|pypi-|sb_secret_|sbp_|do[opr]_v1_|lin_api_|ntn_|secret_|shp(?:at|ss|ca|pa)_|:AA|AccountKey=|PRIVATE KEY|eyJ/i;

export interface KeyMatch {
  format: SecretFormat | { id: 'supabase-service-jwt'; name: string; prefix: string; testKey?: false };
  value: string;
  index: number;
}

/** Every provider key in a text, without overlaps (the first, most specific format wins). */
export function findProviderKeys(text: string): KeyMatch[] {
  if (!QUICK.test(text)) return [];
  const taken: Array<[number, number]> = [];
  const out: KeyMatch[] = [];
  const overlaps = (start: number, end: number) => taken.some(([s, e]) => start < e && end > s);
  for (const format of SECRET_FORMATS) {
    const re = new RegExp(format.pattern.source, format.pattern.flags);
    let m: RegExpExecArray | null;
    while ((m = re.exec(text))) {
      const value = m[0];
      const start = m.index;
      const end = start + value.length;
      if (overlaps(start, end)) continue;
      if (format.validate && !format.validate(value)) continue;
      if (isPlaceholderSecret(value)) continue;
      taken.push([start, end]);
      out.push({ format, value, index: start });
    }
  }
  const jwt = new RegExp(JWT_PATTERN.source, JWT_PATTERN.flags);
  let m: RegExpExecArray | null;
  while ((m = jwt.exec(text))) {
    const payload = decodeJwtPayload(m[0]);
    if (!payload || payload.role !== 'service_role') continue;
    // The Supabase CLI's local development keys are published and the same for everyone.
    if (payload.iss === 'supabase-demo') continue;
    if (overlaps(m.index, m.index + m[0].length)) continue;
    out.push({ format: { id: 'supabase-service-jwt', name: 'Supabase service role key', prefix: 'eyJ' }, value: m[0], index: m.index });
  }
  return out.sort((a, b) => a.index - b.index);
}

const LABELED_FAKE = /(\/\/|#|\/\*|<!--).*\b(dummy|fake|mock|sample|placeholder|not a real)\b/i;

const FIREBASE_CONFIG = /authDomain|messagingSenderId|storageBucket|measurementId|databaseURL|appId\s*:/;
const BROWSER_KEY_NAME = /firebase|maps|places|recaptcha|youtube/i;
const GEMINI_CONTEXT = /gemini|generativelanguage|GoogleGenerativeAI|GoogleGenAI|genai|generative[-_ ]?ai|vertex|palm/i;

/** The innermost {...} around an offset (bounded scan, strings not parsed). */
function enclosingBlock(text: string, index: number): string {
  let depth = 0;
  let start = -1;
  for (let i = index - 1; i >= Math.max(0, index - 3000); i--) {
    const ch = text[i];
    if (ch === '}') depth++;
    else if (ch === '{') {
      if (depth === 0) {
        start = i;
        break;
      }
      depth--;
    }
  }
  if (start === -1) return '';
  depth = 0;
  for (let i = index; i < Math.min(text.length, index + 3000); i++) {
    const ch = text[i];
    if (ch === '{') depth++;
    else if (ch === '}') {
      if (depth === 0) return text.slice(start, i + 1);
      depth--;
    }
  }
  return text.slice(start, Math.min(text.length, index + 3000));
}

/**
 * Google API keys (AIza...) are secrets for Gemini and most Cloud APIs, and
 * public by design in Firebase web config and Maps embeds.
 */
function googleKeyVerdict(text: string, lines: readonly string[], line: number, index: number): 'skip' | 'block' | 'warn' {
  const sameLine = lines[line - 1] ?? '';
  if (GEMINI_CONTEXT.test(sameLine)) return 'block';
  if (BROWSER_KEY_NAME.test(sameLine)) return 'skip';
  const block = enclosingBlock(text, index);
  if (FIREBASE_CONFIG.test(block)) return 'skip';
  if (GEMINI_CONTEXT.test(block)) return 'block';
  const near = lines.slice(Math.max(0, line - 3), line + 1).join('\n');
  if (GEMINI_CONTEXT.test(near)) return 'block';
  return 'warn';
}

export const providerKey: Rule = {
  meta: {
    id: 'secret/provider-key',
    level: 'block',
    scope: 'file',
    title: 'Provider credential in source',
    summary: 'A literal credential in a known provider format (OpenAI, Anthropic, AWS, GitHub, Stripe, Supabase service role, and about 30 others) in any text file.',
    why: 'A key in a repository is readable by everyone with access to the code, its history, and its CI logs, and it stays in git history after the line is deleted. Keys in client code are public.',
    fix: 'Read the key from an environment variable, keep the value in an ignored .env file or a secret manager, and rotate the exposed key.',
    cwe: ['CWE-798'],
    owasp: ['A07:2025'],
    levels: 'block for live credentials; warn for test-mode keys (sk_test_) and for Google API keys whose use is unclear.',
  },
  appliesTo: (file: FileInfo) => !file.generated && !isEnvFileName(file.path),
  text(ctx: TextContext) {
    const matches = findProviderKeys(ctx.text);
    if (matches.length === 0) return;
    const starts = lineStarts(ctx.text);
    for (const match of matches) {
      const pos = offsetToPosition(starts, match.index);
      let level: 'block' | 'warn' = match.format.testKey ? 'warn' : 'block';
      let note = '';
      if (match.format.id === 'google-api') {
        const verdict = googleKeyVerdict(ctx.text, ctx.lines, pos.line, match.index);
        if (verdict === 'skip') continue;
        level = verdict;
        if (verdict === 'warn') note = ' If it is a Firebase or Maps browser key it is public by design; restrict it to your domains in the Google Cloud console.';
      }
      const lineText = ctx.lines[pos.line - 1] ?? '';
      // Azurite, the Azure Storage emulator, has one published account key that everyone uses.
      if (match.format.id === 'azure-storage' && /devstoreaccount1/i.test(lineText)) continue;
      // A value its author labeled as fake, in a test, an example, or the docs.
      if (LABELED_FAKE.test(lineText.slice(match.index - (starts[pos.line - 1] ?? 0) + match.value.length)) && (ctx.file.contexts.has('test') || ctx.file.contexts.has('example') || ctx.file.contexts.has('docs'))) continue;
      const masked = maskValue(match.value, match.format.prefix);
      // Show the line with the key masked; a key that spans lines shows only its masked form.
      // Private key matches cover the header and the start of the body, so the rest of the line is key material too.
      const evidence = match.format.id.startsWith('private-key') || !lineText.includes(match.value) ? masked : lineText.split(match.value).join(masked).trim();
      const where = ctx.file.client ? ' in code that ships to the browser' : '';
      ctx.report({
        line: pos.line,
        column: pos.column,
        endColumn: pos.column + match.value.length,
        level,
        message: `${match.format.name} in ${ctx.file.lang === 'markdown' ? 'a document' : 'source'}${where}: ${masked}.${note}`,
        evidence,
        key: match.format.id,
        fix: match.format.testKey
          ? 'Read the test key from an environment variable too; test keys still give access to your test account.'
          : `Move it to an environment variable (for example process.env.${suggestEnvName(match.format.id)}) and rotate the key, because it is exposed.`,
      });
    }
  },
};

function suggestEnvName(formatId: string): string {
  const map: Record<string, string> = {
    anthropic: 'ANTHROPIC_API_KEY',
    'openai-project': 'OPENAI_API_KEY',
    'openai-legacy': 'OPENAI_API_KEY',
    openrouter: 'OPENROUTER_API_KEY',
    groq: 'GROQ_API_KEY',
    xai: 'XAI_API_KEY',
    replicate: 'REPLICATE_API_TOKEN',
    huggingface: 'HF_TOKEN',
    pinecone: 'PINECONE_API_KEY',
    'google-api': 'GOOGLE_GENERATIVE_AI_API_KEY',
    'aws-access-key': 'AWS_ACCESS_KEY_ID',
    'aws-secret-key': 'AWS_SECRET_ACCESS_KEY',
    'github-classic': 'GITHUB_TOKEN',
    'github-fine-grained': 'GITHUB_TOKEN',
    gitlab: 'GITLAB_TOKEN',
    'stripe-live': 'STRIPE_SECRET_KEY',
    'stripe-test': 'STRIPE_SECRET_KEY',
    'stripe-webhook': 'STRIPE_WEBHOOK_SECRET',
    'slack-token': 'SLACK_BOT_TOKEN',
    'slack-webhook': 'SLACK_WEBHOOK_URL',
    sendgrid: 'SENDGRID_API_KEY',
    resend: 'RESEND_API_KEY',
    npm: 'NPM_TOKEN',
    pypi: 'PYPI_TOKEN',
    'supabase-secret': 'SUPABASE_SECRET_KEY',
    'supabase-pat': 'SUPABASE_ACCESS_TOKEN',
    'supabase-service-jwt': 'SUPABASE_SERVICE_ROLE_KEY',
    digitalocean: 'DIGITALOCEAN_TOKEN',
    linear: 'LINEAR_API_KEY',
    notion: 'NOTION_TOKEN',
    shopify: 'SHOPIFY_ACCESS_TOKEN',
    telegram: 'TELEGRAM_BOT_TOKEN',
    'azure-storage': 'AZURE_STORAGE_CONNECTION_STRING',
    'private-key': 'PRIVATE_KEY',
  };
  return map[formatId] ?? 'API_KEY';
}
