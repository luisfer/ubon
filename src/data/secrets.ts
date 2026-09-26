/**
 * Provider credential formats.
 *
 * Patterns are adapted from gitleaks and Betterleaks (both MIT licensed) and
 * narrowed to formats with a distinctive prefix, so a match is almost always a
 * real credential. Every format has flagged and safe fixtures in
 * fixtures/rules/secret/provider-key.
 *
 * `prefix` is the literal part that is safe to show when the value is masked.
 */

export interface SecretFormat {
  id: string;
  name: string;
  /** Must be a global regex. The whole match is the secret. */
  pattern: RegExp;
  prefix: string;
  /** Test-mode keys are reported as warnings instead of blocking. */
  testKey?: boolean;
  /** Extra check on the matched value; return false to discard the match. */
  validate?: (value: string) => boolean;
}

const hasEntropy = (min: number) => (value: string) => shannonEntropy(value) >= min;

export const SECRET_FORMATS: SecretFormat[] = [
  { id: 'anthropic', name: 'Anthropic API key', pattern: /\bsk-ant-(?:api|admin|oat)\d{2}-[A-Za-z0-9_-]{40,}/g, prefix: 'sk-ant-' },
  { id: 'openrouter', name: 'OpenRouter API key', pattern: /\bsk-or-v1-[a-f0-9]{64}\b/g, prefix: 'sk-or-v1-' },
  { id: 'openai-project', name: 'OpenAI API key', pattern: /\bsk-(?:proj|svcacct|admin)-[A-Za-z0-9_-]{40,}/g, prefix: 'sk-proj-', validate: hasEntropy(3.5) },
  { id: 'openai-legacy', name: 'OpenAI API key', pattern: /\bsk-[A-Za-z0-9]{20}T3BlbkFJ[A-Za-z0-9]{20}\b/g, prefix: 'sk-' },
  {
    id: 'sk-generic',
    name: 'API key with an sk- prefix',
    pattern: /\bsk-[A-Za-z0-9]{32,}\b/g,
    prefix: 'sk-',
    validate: (v) => shannonEntropy(v.slice(3)) >= 3.8 && /[0-9]/.test(v) && /[A-Za-z]/.test(v),
  },
  { id: 'groq', name: 'Groq API key', pattern: /\bgsk_[A-Za-z0-9]{48,56}\b/g, prefix: 'gsk_' },
  { id: 'xai', name: 'xAI API key', pattern: /\bxai-[A-Za-z0-9]{70,90}\b/g, prefix: 'xai-' },
  { id: 'replicate', name: 'Replicate API token', pattern: /\br8_[A-Za-z0-9]{37}\b/g, prefix: 'r8_' },
  { id: 'huggingface', name: 'Hugging Face token', pattern: /\bhf_[A-Za-z]{34}\b/g, prefix: 'hf_', validate: hasEntropy(3.5) },
  { id: 'pinecone', name: 'Pinecone API key', pattern: /\bpcsk_[A-Za-z0-9_]{50,}\b/g, prefix: 'pcsk_' },
  {
    id: 'google-api',
    name: 'Google API key',
    pattern: /\bAIza[0-9A-Za-z_-]{35}\b/g,
    prefix: 'AIza',
  },
  { id: 'aws-access-key', name: 'AWS access key ID', pattern: /\b(?:AKIA|ASIA|ABIA|ACCA)[A-Z0-9]{16}\b/g, prefix: 'AKIA', validate: (v) => !/EXAMPLE$/.test(v) },
  {
    id: 'aws-secret-key',
    name: 'AWS secret access key',
    pattern: /\baws_?secret_?access_?key["']?\s*[:=]\s*["']?[A-Za-z0-9/+=]{40}\b/gi,
    prefix: 'aws_secret_access_key',
    validate: (v) => !/EXAMPLEKEY/.test(v),
  },
  { id: 'github-classic', name: 'GitHub token', pattern: /\bgh[pousr]_[A-Za-z0-9]{36,255}\b/g, prefix: 'ghp_' },
  { id: 'github-fine-grained', name: 'GitHub fine-grained token', pattern: /\bgithub_pat_[A-Za-z0-9_]{60,}\b/g, prefix: 'github_pat_' },
  { id: 'gitlab', name: 'GitLab token', pattern: /\bglpat-[A-Za-z0-9_-]{20,}\b/g, prefix: 'glpat-' },
  { id: 'stripe-live', name: 'Stripe or Clerk live secret key', pattern: /\b(?:sk|rk)_live_[A-Za-z0-9]{20,}\b/g, prefix: 'sk_live_' },
  { id: 'stripe-test', name: 'Stripe or Clerk test secret key', pattern: /\b(?:sk|rk)_test_[A-Za-z0-9]{20,}\b/g, prefix: 'sk_test_', testKey: true },
  { id: 'stripe-webhook', name: 'Stripe webhook signing secret', pattern: /\bwhsec_[A-Za-z0-9+/=]{32,}\b/g, prefix: 'whsec_' },
  { id: 'slack-token', name: 'Slack token', pattern: /\bxox[baprse]-[0-9A-Za-z-]{10,}\b/g, prefix: 'xox' },
  {
    id: 'slack-webhook',
    name: 'Slack webhook URL',
    pattern: /https:\/\/hooks\.slack\.com\/(?:services|workflows|triggers)\/[A-Za-z0-9_/+-]{20,}/g,
    prefix: 'https://hooks.slack.com/',
  },
  { id: 'sendgrid', name: 'SendGrid API key', pattern: /\bSG\.[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{43}\b/g, prefix: 'SG.' },
  { id: 'resend', name: 'Resend API key', pattern: /\bre_[A-Za-z0-9]{8}_[A-Za-z0-9]{24,}\b/g, prefix: 're_', validate: hasEntropy(3.5) },
  { id: 'npm', name: 'npm access token', pattern: /\bnpm_[A-Za-z0-9]{36}\b/g, prefix: 'npm_' },
  { id: 'pypi', name: 'PyPI API token', pattern: /\bpypi-AgEIcHlwaS5vcmc[A-Za-z0-9_-]{50,}/g, prefix: 'pypi-' },
  { id: 'supabase-secret', name: 'Supabase secret key', pattern: /\bsb_secret_[A-Za-z0-9_-]{20,}/g, prefix: 'sb_secret_' },
  { id: 'supabase-pat', name: 'Supabase access token', pattern: /\bsbp_[a-f0-9]{40}\b/g, prefix: 'sbp_' },
  { id: 'digitalocean', name: 'DigitalOcean token', pattern: /\bdo[opr]_v1_[a-f0-9]{64}\b/g, prefix: 'dop_v1_' },
  { id: 'linear', name: 'Linear API key', pattern: /\blin_api_[A-Za-z0-9]{40}\b/g, prefix: 'lin_api_' },
  { id: 'notion', name: 'Notion integration token', pattern: /\b(?:ntn_[A-Za-z0-9]{40,}|secret_[A-Za-z0-9]{43})\b/g, prefix: 'ntn_', validate: hasEntropy(3.5) },
  { id: 'shopify', name: 'Shopify access token', pattern: /\bshp(?:at|ss|ca|pa)_[a-fA-F0-9]{32}\b/g, prefix: 'shpat_' },
  { id: 'telegram', name: 'Telegram bot token', pattern: /\b\d{8,10}:AA[A-Za-z0-9_-]{33}\b/g, prefix: '' },
  {
    id: 'azure-storage',
    name: 'Azure storage account key',
    pattern: /\bAccountKey=[A-Za-z0-9+/]{86}==/g,
    prefix: 'AccountKey=',
  },
  {
    id: 'private-key',
    name: 'Private key',
    pattern: /-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP |ENCRYPTED )?PRIVATE KEY(?: BLOCK)?-----(?:\\n|\s)+[A-Za-z0-9+/=]{40,}/g,
    prefix: '-----BEGIN PRIVATE KEY-----',
  },
];

/** JWTs are matched separately so the payload can be inspected (Supabase service role keys). */
export const JWT_PATTERN = /\beyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g;

export function decodeJwtPayload(token: string): Record<string, unknown> | null {
  const part = token.split('.')[1];
  if (!part) return null;
  try {
    const json = Buffer.from(part.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
    const value = JSON.parse(json) as unknown;
    return value && typeof value === 'object' ? (value as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

export function shannonEntropy(value: string): number {
  if (!value) return 0;
  const counts = new Map<string, number>();
  for (const ch of value) counts.set(ch, (counts.get(ch) ?? 0) + 1);
  let entropy = 0;
  for (const count of counts.values()) {
    const p = count / value.length;
    entropy -= p * Math.log2(p);
  }
  return entropy;
}

const PLACEHOLDER_WORDS = /(?:x{4,}|X{4,}|your[_-]?|example|EXAMPLE|dummy|placeholder|changeme|redacted|REDACTED|fake|sample|<[^>]*>|\$\{|\{\{|\.\.\.|\*{3,})/;

/** True when a matched value looks like documentation or a placeholder. */
export function isPlaceholderSecret(value: string): boolean {
  if (PLACEHOLDER_WORDS.test(value)) return true;
  // Six or more repeats of one character, as in sk-aaaaaaaaaaaa.
  if (/(.)\1{5,}/.test(value)) return true;
  if (/(?:0123456789|123456789|abcdefghij|ABCDEFGHIJ)/.test(value)) return true;
  // Very low entropy in the random part.
  const body = value.replace(/^[A-Za-z]+[-_]+(?:[A-Za-z0-9]+[-_]+)?/, '');
  if (body.length >= 16 && shannonEntropy(body) < 3) return true;
  return false;
}
