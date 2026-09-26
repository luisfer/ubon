import type { Project } from '../../core/project.ts';

/**
 * Environment variable names: which prefixes a framework exposes to the
 * browser, and which names say the value is a secret.
 */

export interface PublicPrefix {
  prefix: string;
  /** Frameworks for which the prefix means "shipped to the browser". Empty: always. */
  frameworks: string[];
  label: string;
}

export const PUBLIC_PREFIXES: readonly PublicPrefix[] = [
  { prefix: 'NEXT_PUBLIC_', frameworks: [], label: 'Next.js' },
  { prefix: 'EXPO_PUBLIC_', frameworks: [], label: 'Expo' },
  { prefix: 'NUXT_PUBLIC_', frameworks: [], label: 'Nuxt' },
  { prefix: 'REACT_APP_', frameworks: [], label: 'Create React App' },
  { prefix: 'GATSBY_', frameworks: [], label: 'Gatsby' },
  { prefix: 'VITE_', frameworks: [], label: 'Vite' },
  { prefix: 'PUBLIC_', frameworks: ['sveltekit', 'astro'], label: 'SvelteKit and Astro' },
];

export function publicPrefixOf(name: string, project?: Project, path?: string): PublicPrefix | null {
  for (const p of PUBLIC_PREFIXES) {
    if (!name.startsWith(p.prefix) || name.length === p.prefix.length) continue;
    if (p.frameworks.length === 0) return p;
    if (!project || path === undefined) return null;
    const fw = project.frameworksFor(path);
    if (p.frameworks.some((f) => fw.has(f as never))) return p;
    return null;
  }
  return null;
}

/** Parts of a name that mark a value as public by design. */
const PUBLIC_BY_DESIGN = /(^|_)(PUBLISHABLE|ANON|PUBLIC_KEY|SITE_KEY|MEASUREMENT_ID|CLIENT_ID|PROJECT_ID|APP_ID|DSN|APP_KEY_ID)(_|$)/;

const GENERIC_SECRET = /(^|_)(SECRET|SECRETS|PASSWORD|PASSWD|PASSPHRASE|PRIVATE_KEY|PRIVATE_TOKEN|SERVICE_ROLE|SERVICE_ROLE_KEY|SERVICE_KEY|ENCRYPTION_KEY|SIGNING_KEY|MASTER_KEY|ADMIN_KEY|ADMIN_TOKEN|ACCESS_KEY_SECRET|CREDENTIALS|SERVICE_ACCOUNT_KEY|SERVICE_ACCOUNT_JSON)(_|$)/;

const DATABASE_URL = /(^|_)(DATABASE_URL|DB_URL|POSTGRES_URL|POSTGRES_PRISMA_URL|POSTGRES_URL_NON_POOLING|DIRECT_URL|MONGODB_URI|MONGODB_URL|MONGO_URI|MONGO_URL|MYSQL_URL|REDIS_URL|KV_URL|SUPABASE_DB_URL|NEON_DATABASE_URL|TURSO_AUTH_TOKEN)$/;

const PROVIDERS =
  'OPENAI|AZURE_OPENAI|ANTHROPIC|CLAUDE|GROQ|XAI|GROK|MISTRAL|COHERE|REPLICATE|HUGGINGFACE|HUGGING_FACE|HF|PINECONE|DEEPSEEK|PERPLEXITY|TOGETHER|TOGETHER_AI|FIREWORKS|OPENROUTER|ELEVENLABS|RESEND|SENDGRID|POSTMARK|MAILGUN|TWILIO|LANGCHAIN|LANGSMITH|GEMINI|GOOGLE_GENERATIVE_AI|GOOGLE_AI|VOYAGE|JINA|TAVILY|SERPAPI|SERPER|EXA|FIRECRAWL|BROWSERBASE|E2B|MODAL|RUNPOD|LLAMA_CLOUD|UPSTASH_REDIS_REST|UPSTASH_REDIS|KV_REST_API|BLOB_READ_WRITE|GITHUB|GH|GITLAB|SLACK|SLACK_BOT|DISCORD|DISCORD_BOT|TELEGRAM|TELEGRAM_BOT|NOTION|LINEAR|AIRTABLE|SHOPIFY_ADMIN|VERCEL|NETLIFY|CLOUDFLARE|CF|SUPABASE_ACCESS|NPM|PYPI|DOCKER|DOCKERHUB|SENTRY_AUTH|DATADOG|DD|STRIPE_RESTRICTED|PLAID|LEMONSQUEEZY|LEMON_SQUEEZY|PADDLE|POLAR|ALGOLIA_ADMIN|MAPBOX_SECRET|OPENWEATHER|ASSEMBLYAI|DEEPGRAM|FAL|FAL_AI|STABILITY|MIDJOURNEY|RUNWAY|LUMA|IDEOGRAM|NVIDIA|NVIDIA_NIM|CEREBRAS|SAMBANOVA|AI21|MOONSHOT|ZHIPU|QWEN|DASHSCOPE|BEDROCK|VERTEX';

const PROVIDER_KEY = new RegExp(`^(?:[A-Z0-9]+_)*?(?:${PROVIDERS})(?:_[A-Z0-9]+)*?_(?:API_KEY|APIKEY|KEY|TOKEN|API_TOKEN|ACCESS_TOKEN|AUTH_TOKEN|BOT_TOKEN|REST_TOKEN|REST_API_TOKEN|READ_WRITE_TOKEN|SECRET_KEY|SECRET)$`);

/**
 * True when an environment variable name says its value is a secret. The name
 * may include a public prefix; the check applies to the rest of the name.
 */
export function isSecretName(name: string): boolean {
  const upper = name.toUpperCase();
  const bare = stripPublicPrefix(upper);
  if (PUBLIC_BY_DESIGN.test(bare)) return false;
  return GENERIC_SECRET.test(bare) || DATABASE_URL.test(bare) || PROVIDER_KEY.test(bare);
}

/** Loose check for config keys and variables: credential-shaped names (token, key, secret, password). */
export function isCredentialShapedName(name: string): boolean {
  const normalized = name
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/[-.\s]/g, '_')
    .toUpperCase();
  if (PUBLIC_BY_DESIGN.test(normalized)) return false;
  if (isSecretName(normalized)) return true;
  return /(^|_)(TOKEN|API_KEY|APIKEY|AUTH|AUTHORIZATION|BEARER|SECRET|PASSWORD|PASSWD|PAT|ACCESS_KEY|PRIVATE_KEY|CLIENT_SECRET|X_API_KEY)(_|$)/.test(normalized);
}

export function stripPublicPrefix(name: string): string {
  for (const p of PUBLIC_PREFIXES) if (name.startsWith(p.prefix)) return name.slice(p.prefix.length);
  return name;
}

/** Values that are clearly not a real secret: empty, placeholders, references to other variables. */
export function isPlaceholderValue(value: string): boolean {
  const v = value.trim().replace(/^["']|["']$/g, '');
  if (v.length < 8) return true;
  if (/^\$\{?[A-Za-z_][A-Za-z0-9_]*\}?$/.test(v)) return true;
  if (/\$\{\{?|\{\{|<[^>]+>|\[[A-Z_ -]+\]/.test(v)) return true;
  if (/^(true|false|null|undefined|none|changeme|change_me|secret|password|test|dev|development|production|localhost)$/i.test(v)) return true;
  if (/x{4,}|\*{3,}|\.{3}|your[_-]|example|placeholder|dummy|sample|replace[_-]?me|todo|redacted|fake|insert[_-]/i.test(v)) return true;
  if (/(.)\1{5,}/.test(v)) return true;
  return false;
}

/** `.env` files that hold real values (not the example and template variants, not test env files). */
export function isEnvFileName(path: string): boolean {
  const base = path.slice(path.lastIndexOf('/') + 1);
  if (!/^\.env(\.[\w.-]+)?$/.test(base) && !/^[\w-]+\.env$/.test(base)) return false;
  return !/\.(example|sample|template|dist|defaults|schema|tmpl|tpl|ci)$|\.example\.|^\.env\.(test|testing)$/.test(base);
}

const LOCAL_HOSTS = /^(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\]|::1|db|database|postgres|postgresql|mysql|mariadb|mongo|mongodb|redis|rabbitmq|host\.docker\.internal)$/i;
const DEFAULT_PASSWORDS = /^(postgres|password|pass|passwd|secret|example|root|admin|mysql|mongo|redis|guest|test|testing|dev|development|changeme|pwd|user|docker|prisma|local)$/i;

export function isLocalHost(host: string): boolean {
  return LOCAL_HOSTS.test(host);
}

export function isDefaultPassword(password: string): boolean {
  return DEFAULT_PASSWORDS.test(password);
}

/** A connection URL for local development: a local host or a well-known default password. */
export function isLocalConnectionUrl(value: string): boolean {
  const m = /:\/\/[^\s:/@]*:([^\s@]+)@([^\s/:?]+)/.exec(value);
  if (!m) return false;
  return isLocalHost(m[2] ?? '') || isDefaultPassword(m[1] ?? '');
}
