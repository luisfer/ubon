import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { listFilesRecursive } from './fixtures.ts';

/**
 * Fake credentials in every provider format, generated at test time.
 *
 * Fixture files never contain key-shaped strings. They contain markers such
 * as {{fake:openai-project}} (or {{fake:openai-project:2}} for a second,
 * different value), which the tests expand in a temporary copy. This keeps
 * the repository free of anything a secret scanner (or GitHub push
 * protection) would flag, and it means every run tests fresh random keys of
 * the right shape.
 */

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function seedOf(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

const ALNUM = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
const UPPER_NUM = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
const HEX = '0123456789abcdef';
const URLSAFE = `${ALNUM}_-`;
const B64 = `${ALNUM}+/`;
const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';

function randomString(rand: () => number, alphabet: string, length: number): string {
  let out = '';
  while (out.length < length) {
    const ch = alphabet[Math.floor(rand() * alphabet.length)] as string;
    // Avoid runs and words that placeholder detection (rightly) rejects.
    if (out.length > 0 && out[out.length - 1] === ch) continue;
    out += ch;
  }
  if (/fake|test|sample|dummy|xxxx|EXAMPLE|example|abcdef|012345/i.test(out)) return randomString(rand, alphabet, length);
  return out;
}

function b64url(value: string): string {
  return Buffer.from(value).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
}

type Generator = (rand: () => number) => string;

export const FAKE_KEY_GENERATORS: Record<string, Generator> = {
  anthropic: (r) => `sk-ant-api03-${randomString(r, URLSAFE, 93)}AA`,
  openrouter: (r) => `sk-or-v1-${randomString(r, HEX, 64)}`,
  'openai-project': (r) => `sk-proj-${randomString(r, URLSAFE, 120)}`,
  'openai-legacy': (r) => `sk-${randomString(r, ALNUM, 20)}T3BlbkFJ${randomString(r, ALNUM, 20)}`,
  'sk-generic': (r) => `sk-${randomString(r, ALNUM, 32)}`,
  groq: (r) => `gsk_${randomString(r, ALNUM, 52)}`,
  xai: (r) => `xai-${randomString(r, ALNUM, 80)}`,
  replicate: (r) => `r8_${randomString(r, ALNUM, 37)}`,
  huggingface: (r) => `hf_${randomString(r, LETTERS, 34)}`,
  pinecone: (r) => `pcsk_${randomString(r, `${ALNUM}_`, 64)}`,
  'google-api': (r) => `AIza${randomString(r, URLSAFE, 35)}`,
  'aws-access-key': (r) => `AKIA${randomString(r, UPPER_NUM, 16)}`,
  'aws-secret-key': (r) => `aws_secret_access_key = ${randomString(r, B64, 40)}`,
  'github-classic': (r) => `ghp_${randomString(r, ALNUM, 36)}`,
  'github-fine-grained': (r) => `github_pat_${randomString(r, ALNUM, 22)}_${randomString(r, ALNUM, 59)}`,
  gitlab: (r) => `glpat-${randomString(r, URLSAFE, 20)}`,
  'stripe-live': (r) => `sk_live_${randomString(r, ALNUM, 99)}`,
  'stripe-test': (r) => `sk_test_${randomString(r, ALNUM, 99)}`,
  'stripe-webhook': (r) => `whsec_${randomString(r, ALNUM, 32)}`,
  'slack-token': (r) => `xoxb-${randomString(r, '123456789', 12)}-${randomString(r, '123456789', 13)}-${randomString(r, ALNUM, 24)}`,
  'slack-webhook': (r) => `https://hooks.slack.com/services/T${randomString(r, UPPER_NUM, 8)}/B${randomString(r, UPPER_NUM, 10)}/${randomString(r, ALNUM, 24)}`,
  sendgrid: (r) => `SG.${randomString(r, URLSAFE, 22)}.${randomString(r, URLSAFE, 43)}`,
  resend: (r) => `re_${randomString(r, ALNUM, 8)}_${randomString(r, ALNUM, 24)}`,
  npm: (r) => `npm_${randomString(r, ALNUM, 36)}`,
  pypi: (r) => `pypi-AgEIcHlwaS5vcmc${randomString(r, URLSAFE, 70)}`,
  'supabase-secret': (r) => `sb_secret_${randomString(r, URLSAFE, 32)}`,
  'supabase-pat': (r) => `sbp_${randomString(r, HEX, 40)}`,
  digitalocean: (r) => `dop_v1_${randomString(r, HEX, 64)}`,
  linear: (r) => `lin_api_${randomString(r, ALNUM, 40)}`,
  notion: (r) => `ntn_${randomString(r, ALNUM, 46)}`,
  shopify: (r) => `shpat_${randomString(r, HEX, 32)}`,
  telegram: (r) => `${randomString(r, '123456789', 10)}:AA${randomString(r, URLSAFE, 33)}`,
  'azure-storage': (r) => `AccountKey=${randomString(r, B64, 86)}==`,
  'private-key': (r) => `-----BEGIN RSA PRIVATE KEY-----\\n${randomString(r, B64, 64)}\\n${randomString(r, B64, 64)}\\n-----END RSA PRIVATE KEY-----`,
  'private-key-pem': (r) =>
    `-----BEGIN PRIVATE KEY-----\n${Array.from({ length: 6 }, () => randomString(r, B64, 64)).join('\n')}\n-----END PRIVATE KEY-----`,
  'supabase-service-jwt': (r) =>
    `${b64url('{"alg":"HS256","typ":"JWT"}')}.${b64url(`{"iss":"supabase","ref":"${randomString(r, 'abcdefghijklmnopqrstuvwxyz', 20)}","role":"service_role","iat":1718000000,"exp":2033576000}`)}.${randomString(r, URLSAFE, 43)}`,
  'supabase-anon-jwt': (r) =>
    `${b64url('{"alg":"HS256","typ":"JWT"}')}.${b64url(`{"iss":"supabase","ref":"${randomString(r, 'abcdefghijklmnopqrstuvwxyz', 20)}","role":"anon","iat":1718000000,"exp":2033576000}`)}.${randomString(r, URLSAFE, 43)}`,
  // Shaped like the Supabase CLI's local development key (iss supabase-demo), which is the same for everyone.
  'supabase-demo-service-jwt': (r) =>
    `${b64url('{"alg":"HS256","typ":"JWT"}')}.${b64url('{"iss":"supabase-demo","role":"service_role","exp":1983812996}')}.${randomString(r, URLSAFE, 43)}`,
  'db-password': (r) => randomString(r, ALNUM, 24),
  'high-entropy': (r) => randomString(r, ALNUM, 40),
};

export function fakeKey(id: string, n = 1): string {
  const gen = FAKE_KEY_GENERATORS[id];
  if (!gen) throw new Error(`No fake key generator for "${id}"`);
  return gen(mulberry32(seedOf(`${id}:${n}`)));
}

const MARKER = /\{\{fake:([a-z0-9-]+)(?::(\d+))?\}\}/g;

export function expandFakeKeys(text: string): string {
  return text.replace(MARKER, (_m, id: string, n?: string) => fakeKey(id, n ? Number(n) : 1));
}

/** Expand markers in every file under a directory (a temporary copy of a fixture). */
export function expandFakeKeysInDir(dir: string): void {
  for (const file of listFilesRecursive(dir)) {
    const full = join(dir, file);
    let text: string;
    try {
      text = readFileSync(full, 'utf8');
    } catch {
      continue;
    }
    if (!text.includes('{{fake:')) continue;
    writeFileSync(full, expandFakeKeys(text));
  }
}
